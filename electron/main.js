import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";

import {
  computePartialSHA256,
  computeSsdeep,
  computeSdhash,
  checkHashExists,
  registerFileHashes,
} from "./hasher.js";

let mainWindow;
const PENDING = new Map();

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

/* ---------------- Extension Listener ---------------- */
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
        } catch (e) {
          console.error("Bad request to /download", e);
        }
        res.writeHead(400);
        res.end("bad request");
      });
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });

  server.listen(5050, "127.0.0.1", () =>
    console.log("🌐 Extension listener http://127.0.0.1:5050/download")
  );
}

/* ---------------- App Startup ---------------- */
app.whenReady().then(() => {
  startExtensionListener();
  createWindow();

  ipcMain.on("download", async (_, url) => {
    if (url) await handleDownload(url);
  });

  /* ---------------- Download Manager ---------------- */
  session.defaultSession.on("will-download", (event, item) => {
    const dupId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const filename = item.getFilename();

    // New folder: Downloads/electron
    const electronFolder = path.join(app.getPath("downloads"), "electron");
    fs.mkdirSync(electronFolder, { recursive: true });
    const savePath = path.join(electronFolder, filename);

    // 🔥 Log filename duplicate
    if (fs.existsSync(savePath)) {
      console.log("🚫 BLOCKED: Filename duplicate detected →", savePath);
      mainWindow?.webContents.send("duplicate-detected", {
        name: filename,
        existingPath: savePath,
        matchType: "filename",
      });
      event.preventDefault();
      return;
    }

    item.setSavePath(savePath);
    PENDING.set(dupId, { item, checkedPartial: false, savePath });

    /* ---------- Progress + Duplicate Logging ---------- */
    item.on("updated", async () => {
      const received = item.getReceivedBytes();
      const total = item.getTotalBytes();
      const state = PENDING.get(dupId);
      if (!state) return;

      const percent = total > 0 ? ((received / total) * 100).toFixed(2) : 0;
      console.log(`⬇️ [${filename}] ${percent}%  (${received}/${total})`);

      // Send progress to UI
      mainWindow?.webContents.send("download-progress", {
        name: filename,
        received,
        total,
        percent,
      });

      /* ---- Early Duplicate Check (after 1 MB) ---- */
      if (!state.checkedPartial && received >= 1024 * 1024) {
        state.checkedPartial = true;

        try {
          const partialHash = await computePartialSHA256(savePath, 1024 * 1024);
          const ssdeepHash = computeSsdeep(savePath);
          const sdhashHash = null;

          const hit = await checkHashExists(
            partialHash,
            ssdeepHash,
            sdhashHash
          );

          if (hit.exists) {
            // 🔥 NEW TERMINAL LOGS FOR DUPLICATE DETECTION
            console.log("\n=======================================");
            console.log("⚠️  DUPLICATE DETECTED DURING DOWNLOAD");
            console.log("→ Type:", hit.type);
            console.log("→ Existing file:", hit.path);
            if (hit.score) console.log("→ Similarity score:", hit.score);
            console.log("=======================================\n");

            item.pause();

            mainWindow?.webContents.send("duplicate-detected", {
              dupId,
              name: filename,
              existingPath: hit.path,
              matchType: hit.type,
              score: hit.score || null,
            });

            ipcMain.once(`download-decision-${dupId}`, (_, decision) => {
              if (decision?.continue) item.resume();
              else {
                item.cancel();
                fs.unlink(savePath, () => {});
              }
              PENDING.delete(dupId);
            });
          }
        } catch (err) {
          console.error("Partial duplicate check error:", err);
        }
      }
    });

    /* ---- Finalization ---- */
    item.once("done", async (_, stateStr) => {
      if (stateStr === "completed") {
        console.log(`🏁 Completed: ${item.getSavePath()}`);

        mainWindow?.webContents.send("download-done", {
          filePath: item.getSavePath(),
          name: filename,
        });

        try {
          await registerFileHashes(item.getSavePath());
          console.log(`🔐 Hashes saved for: ${filename}`);
        } catch (err) {
          console.error("Failed to register hashes:", err);
        }
      } else {
        console.log(`❌ Download failed: ${stateStr}`);
        mainWindow?.webContents.send("download-error", { state: stateStr });
      }

      for (const [k, v] of PENDING.entries()) {
        if (v.item === item) PENDING.delete(k);
      }
    });
  });
});

/* ---------------- URL Download Handler ---------------- */
async function handleDownload(url) {
  if (!url) return;

  const guessedName = path.basename(new URL(url).pathname || "unknown");
  const nameToCheck = guessedName || "unknown";

  const hit = await checkHashExists(null, null, null, nameToCheck);
  if (hit.exists) {
    console.log(
      "🚫 BLOCKED BEFORE START (filename duplicate):",
      nameToCheck,
      "→",
      hit.path
    );
    mainWindow?.webContents.send("duplicate-detected", {
      name: nameToCheck,
      existingPath: hit.path,
      matchType: "filename",
    });
    return;
  }

  console.log("⬇️ Starting Electron download for:", url);
  mainWindow?.webContents.downloadURL(url);
}

/* ---------------- Google Drive Handler ---------------- */
function downloadGoogleDriveFile(url) {
  const fileId = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]+)/)?.[1];
  if (!fileId) return;

  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  https.get(directUrl, async (response) => {
    const disposition = response.headers["content-disposition"];
    let filename = `drive_${fileId}`;
    const match = disposition?.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/);
    if (match) filename = decodeURIComponent(match[1]);

    const exists = await checkHashExists(null, null, null, filename);
    if (exists?.exists) {
      console.log("🚫 Google Drive filename duplicate →", exists.path);
      mainWindow?.webContents.send("duplicate-detected", {
        name: filename,
        existingPath: exists.path,
        matchType: "filename",
      });
      response.destroy();
      return;
    }

    const electronFolder = path.join(app.getPath("downloads"), "electron");
    fs.mkdirSync(electronFolder, { recursive: true });
    const filePath = path.join(electronFolder, filename);

    const ws = fs.createWriteStream(filePath);

    response.pipe(ws);
    ws.on("finish", async () => {
      console.log(`📄 Google Drive file saved → ${filePath}`);
      mainWindow?.webContents.send("download-done", { name: filename, filePath });
      await registerFileHashes(filePath);
    });
    ws.on("error", (err) => console.error("Drive write error", err));
  });
}
