import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import {
  computePartialSHA256,
  computeTLSH,
  checkHashExists,
  registerFileHashes,
} from "./hasher.js";

let mainWindow;
const PENDING = new Map(); // dupId -> { item, checkedPartial, savePath }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL("http://localhost:5173");
  console.log("✅ UI Loaded");
}

app.whenReady().then(() => {
  createWindow();
  startExtensionListener();

  // React → Electron: download request
  ipcMain.on("download", async (event, url) => {
    if (!url) return;
    console.log("📥 React requested download:", url);
    await handleDownload(url);
  });

  // Electron’s built-in downloads
  session.defaultSession.on("will-download", (event, item) => {
    const dupId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const filename = item.getFilename();
    const savePath = path.join(app.getPath("downloads"), filename);

    // 1️⃣ Check if file already exists on disk (by name)
    if (fs.existsSync(savePath)) {
      console.log(`🚫 File already exists locally: ${filename}`);
      mainWindow?.webContents.send("duplicate-detected", {
        name: filename,
        existingPath: savePath,
        matchType: "filename",
      });
      event.preventDefault();
      return;
    }

    try {
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
    } catch (e) {
      console.error(e);
    }

    item.setSavePath(savePath);
    console.log("⬇️ Starting:", filename, "dupId:", dupId);

    PENDING.set(dupId, { item, checkedPartial: false, savePath });

    // ---- Progress ----
    item.on("updated", async () => {
      const received = item.getReceivedBytes();
      const total = item.getTotalBytes();
      const state = PENDING.get(dupId);
      if (!state) return;

      mainWindow?.webContents.send("download-progress", {
        name: filename,
        received,
        total,
        percent: total > 0 ? (received / total) * 100 : 0,
      });

      // Early duplicate check after 1 MB
      if (!state.checkedPartial && received >= 1024 * 1024) {
        state.checkedPartial = true;
        try {
          const partialHash = await computePartialSHA256(savePath, 1024 * 1024);
          const fuzzyHash = await computeTLSH(savePath);
          const hit = checkHashExists(partialHash, fuzzyHash);

          if (hit.exists) {
            console.log(
              `⚠️ ${hit.type === "fuzzy" ? "Similar" : "Duplicate"} found:`,
              hit.path
            );

            try {
              item.pause();
            } catch (e) {
              console.error(e);
            }

            if (mainWindow) {
              if (mainWindow.isMinimized()) mainWindow.restore();
              mainWindow.show();
              mainWindow.focus();
            }

            mainWindow?.webContents.send("duplicate-detected", {
              dupId,
              name: filename,
              partialHash,
              existingPath: hit.path,
              matchType: hit.type,
              distance: hit.distance || null,
            });

            ipcMain.once(`download-decision-${dupId}`, (evt, decision) => {
              if (decision && decision.continue) {
                try {
                  item.resume();
                } catch (e) {
                  console.error("resume failed", e);
                }
              } else {
                try {
                  item.cancel();
                  fs.unlink(savePath, () => {});
                } catch (e) {
                  console.error(e);
                }
              }
              PENDING.delete(dupId);
            });
          }
        } catch (err) {
          console.error("Partial hash error:", err);
        }
      }
    });

    // ---- On Complete / Cancel ----
    item.once("done", async (eventDone, stateStr) => {
      if (stateStr === "completed") {
        console.log("✅ Completed:", item.getSavePath());
        mainWindow?.webContents.send("download-done", {
          filePath: item.getSavePath(),
          name: filename,
        });

        try {
          await registerFileHashes(item.getSavePath());
          console.log("🔐 Registered SHA-256 + TLSH for", filename);
        } catch (err) {
          console.error("Failed to register hashes:", err);
        }
      } else {
        console.log("❌ Download failed or cancelled:", stateStr);
        mainWindow?.webContents.send("download-error", { state: stateStr });
      }

      for (const [k, v] of PENDING.entries()) {
        if (v.item === item) PENDING.delete(k);
      }
    });
  });
});

/* ---------------- Localhost Server for Chrome Extension ---------------- */
function startExtensionListener() {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/download") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const url = parsed.url;
          if (url) {
            console.log("🔔 Received URL from extension:", url);
            await handleDownload(url);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
            return;
          }
        } catch (err) {
          console.error("Bad request to /download", err);
        }
        res.writeHead(400);
        res.end("bad request");
      });
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });

  server.listen(5050, "127.0.0.1", () => {
    console.log("🌐 Extension listener running at http://127.0.0.1:5050/download");
  });
}

/* ---------------- Download Handler ---------------- */
async function handleDownload(url) {
  if (!url) return;

  const guessedName = path.basename(new URL(url).pathname || "unknown");
  const nameToCheck = guessedName || "unknown";

  try {
    const hit = checkHashExists(null, null, nameToCheck);
    if (hit.exists && hit.type === "filename") {
      console.log("🚫 Duplicate filename detected:", nameToCheck);
      mainWindow?.webContents.send("duplicate-detected", {
        name: nameToCheck,
        existingPath: hit.path,
        matchType: "filename",
      });
      return;
    }
  } catch (e) {
    console.error("Filename duplicate check failed:", e);
  }

  if (url.includes("drive.google.com") || url.includes("drive.usercontent")) {
    downloadGoogleDriveFile(url);
  } else {
    mainWindow?.webContents.downloadURL(url);
  }
}

/* ---------------- Google Drive Handler ---------------- */
function downloadGoogleDriveFile(url) {
  const fileId = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]+)/)?.[1];
  if (!fileId) {
    console.log("❌ No valid file ID found in URL.");
    return;
  }
  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  https
    .get(directUrl, (response) => {
      const disposition = response.headers["content-disposition"];
      let filename = `drive_${fileId}`;
      if (disposition) {
        const m = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/);
        if (m && m[1]) filename = decodeURIComponent(m[1]);
      }

      const check = checkHashExists(null, null, filename);
      if (check.exists && check.type === "filename") {
        console.log("🚫 Duplicate Google Drive filename detected:", filename);
        mainWindow?.webContents.send("duplicate-detected", {
          name: filename,
          existingPath: check.path,
          matchType: "filename",
        });
        response.destroy();
        return;
      }

      const filePath = path.join(app.getPath("downloads"), filename);
      const ws = fs.createWriteStream(filePath);
      response.pipe(ws);
      ws.on("finish", async () => {
        console.log("✅ Saved drive file:", filePath);
        mainWindow?.webContents.send("download-done", { name: filename, filePath });
        try {
          await registerFileHashes(filePath);
        } catch (e) {
          console.error("register drive file hash failed", e);
        }
      });
      ws.on("error", (err) => console.error("write stream error", err));
    })
    .on("error", (err) => console.error("drive fetch error", err));
}
