// main.js
import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";

// Import updated hashing safely
import {
  computePartialSHA256,
  computeSsdeep,
  checkHashExists,
  registerFileHashes,
} from "./hasher.js";

let mainWindow;

const PENDING = new Map();
const PRE_DECISIONS = new Map();
const NEXT_SAVE_PATH = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------------------------------- */
/* WINDOW SETUP                                            */
/* ------------------------------------------------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL("http://localhost:5173");
  console.log("✅ UI Loaded");
}

/* ------------------------------------------------------- */
/* EXTENSION LISTENER                                      */
/* ------------------------------------------------------- */
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
            console.log("🔔 Received URL:", url);
            await handleDownload(url);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
            return;
          }
        } catch (e) {
          console.error("❌ Bad extension POST", e);
        }
        res.writeHead(400);
        res.end("bad request");
      });
    } else {
      res.writeHead(404).end("not found");
    }
  });

  server.listen(5050, "127.0.0.1", () =>
    console.log("🌐 Listening: http://127.0.0.1:5050/download")
  );
}

/* ------------------------------------------------------- */
/* STARTUP                                                 */
/* ------------------------------------------------------- */
app.whenReady().then(() => {
  startExtensionListener();
  createWindow();
  setupIPCDownloadTrigger();
  setupDownloadManager();
});

/* ------------------------------------------------------- */
/* USER INITIATED DOWNLOAD                                 */
/* ------------------------------------------------------- */
function setupIPCDownloadTrigger() {
  ipcMain.on("download", (_, url) => {
    if (url) handleDownload(url);
  });
}

/* ------------------------------------------------------- */
/* DOWNLOAD MANAGER                                        */
/* ------------------------------------------------------- */
function setupDownloadManager() {
  session.defaultSession.on("will-download", (event, item) => {
    const dupId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const filename = item.getFilename();

    const downloadsFolder = path.join(app.getPath("downloads"), "electron");
    fs.mkdirSync(downloadsFolder, { recursive: true });

    let savePath = NEXT_SAVE_PATH.get(filename);
    if (savePath) {
      NEXT_SAVE_PATH.delete(filename);
    } else {
      savePath = path.join(downloadsFolder, filename);
    }

    /* FILENAME DUP CHECK */
    if (!NEXT_SAVE_PATH.has(filename) && fs.existsSync(savePath)) {
      mainWindow?.webContents.send("duplicate-detected", {
        dupId: null,
        name: filename,
        existingPath: savePath,
        matchType: "filename",
      });

      event.preventDefault();
      return;
    }

    item.setSavePath(savePath);
    PENDING.set(dupId, { item, checkedPartial: false, savePath });

    /* --------------------------------------------------- */
    /* PROGRESS EVENT                                      */
    /* --------------------------------------------------- */
    item.on("updated", async () => {
      const state = PENDING.get(dupId);
      if (!state) return;

      const received = item.getReceivedBytes();
      const total = item.getTotalBytes();
      const percent = total ? ((received / total) * 100).toFixed(2) : "0";

      mainWindow?.webContents.send("download-progress", {
        name: filename,
        received,
        total,
        percent,
      });

      /* -------- PARTIAL DUPLICATE CHECK -------- */
      if (!state.checkedPartial && received >= 1024 * 1024) {
        state.checkedPartial = true;

        try {
          const partialHash = await computePartialSHA256(savePath);
          const ssdeepHash = await computeSsdeep(savePath); // FIXED (async)

          const hit = await checkHashExists(partialHash, ssdeepHash, null);

          if (hit.exists) {
            console.log("⚠️ DUPLICATE DETECTED DURING DOWNLOAD:", hit);
            item.pause();

            mainWindow?.webContents.send("duplicate-detected", {
              dupId,
              name: filename,
              existingPath: hit.path,
              matchType: hit.type,
              score: hit.score || null,
            });

            waitForDecisionDuringDownload(
              dupId,
              item,
              savePath,
              filename,
              hit
            );
          }
        } catch (err) {
          console.error("Partial dup check error:", err);
        }
      }
    });

    /* --------------------------------------------------- */
    /* DOWNLOAD COMPLETED                                  */
    /* --------------------------------------------------- */
    item.once("done", async (_, stateStr) => {
      const finalPath = item.getSavePath();

      if (stateStr === "completed") {
        mainWindow?.webContents.send("download-done", {
          filePath: finalPath,
          name: filename,
        });

        /* SAFE POST-DOWNLOAD HASHING (non-blocking) */
        setTimeout(() => {
          registerFileHashes(finalPath)
            .then(() => console.log("🔐 Hashes stored"))
            .catch(console.error);
        }, 100);
      } else {
        mainWindow?.webContents.send("download-error", { state: stateStr });
      }

      // Cleanup
      for (const [k, v] of PENDING.entries()) {
        if (v.item === item) PENDING.delete(k);
      }
    });
  });
}

/* ------------------------------------------------------- */
/* DUP DECISION DURING DOWNLOAD                            */
/* ------------------------------------------------------- */
function waitForDecisionDuringDownload(dupId, item, savePath, filename, hit) {
  ipcMain.once(`download-decision-${dupId}`, (_, decision) => {
    if (!decision) {
      item.cancel();
      fs.unlink(savePath, () => {});
      return;
    }

    if (decision.action === "overwrite") {
      try {
        fs.unlinkSync(hit.path);
      } catch {}
      item.setSavePath(hit.path);
      item.resume();
      return;
    }

    if (decision.action === "rename") {
      const base = path.basename(savePath, path.extname(savePath));
      const ext = path.extname(savePath);
      const dir = path.dirname(savePath);

      let counter = 1;
      let newPath = path.join(dir, `${base} (${counter})${ext}`);
      while (fs.existsSync(newPath)) {
        counter++;
        newPath = path.join(dir, `${base} (${counter})${ext}`);
      }

      item.setSavePath(newPath);
      item.resume();
      return;
    }

    if (decision.action === "skip") {
      item.cancel();
      fs.unlink(savePath, () => {});
      return;
    }

    if (decision.continue) {
      item.resume();
    } else {
      item.cancel();
    }
  });
}

/* ------------------------------------------------------- */
/* URL DOWNLOAD STARTER                                    */
/* ------------------------------------------------------- */
async function handleDownload(url) {
  if (!url) return;

  const guessedName = path.basename(new URL(url).pathname || "unknown");
  const electronFolder = path.join(app.getPath("downloads"), "electron");

  fs.mkdirSync(electronFolder, { recursive: true });

  const existingPath = path.join(electronFolder, guessedName);

  if (fs.existsSync(existingPath)) {
    handlePreDownloadDuplicate(url, guessedName, existingPath);
    return;
  }

  mainWindow?.webContents.downloadURL(url);
}

/* ------------------------------------------------------- */
/* PRE-DOWNLOAD DUP HANDLING                               */
/* ------------------------------------------------------- */
function handlePreDownloadDuplicate(url, filename, existingPath) {
  const dupId = `${Date.now()}-pre-${Math.random().toString(36).slice(2)}`;
  PRE_DECISIONS.set(dupId, { url, filename, existingPath });

  mainWindow?.webContents.send("duplicate-detected", {
    dupId,
    name: filename,
    existingPath,
    matchType: "filename",
  });

  ipcMain.once(`download-decision-${dupId}`, (_, decision) => {
    PRE_DECISIONS.delete(dupId);
    if (!decision) return;

    if (decision.action === "overwrite") {
      try {
        fs.unlinkSync(existingPath);
      } catch {}
      NEXT_SAVE_PATH.set(filename, existingPath);
      mainWindow?.webContents.downloadURL(url);
      return;
    }

    if (decision.action === "rename") {
      const base = path.basename(existingPath, path.extname(existingPath));
      const ext = path.extname(existingPath);
      const dir = path.dirname(existingPath);

      let counter = 1;
      let newPath = path.join(dir, `${base} (${counter})${ext}`);
      while (fs.existsSync(newPath)) {
        counter++;
        newPath = path.join(dir, `${base} (${counter})${ext}`);
      }

      NEXT_SAVE_PATH.set(filename, newPath);
      mainWindow?.webContents.downloadURL(url);
      return;
    }
  });
}

/* ------------------------------------------------------- */
/* GOOGLE DRIVE HANDLING                                   */
/* ------------------------------------------------------- */
function downloadGoogleDriveFile(url) {
  const fileId = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]+)/)?.[1];
  if (!fileId) return;

  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  https.get(directUrl, async (response) => {
    const disposition = response.headers["content-disposition"];
    let filename = `drive_${fileId}`;
    const match = disposition?.match(/filename\*?=(?:UTF-8'')?["']?([^;"']+)/);
    if (match) filename = decodeURIComponent(match[1]);

    const folder = path.join(app.getPath("downloads"), "electron");
    fs.mkdirSync(folder, { recursive: true });
    const fullPath = path.join(folder, filename);

    if (fs.existsSync(fullPath)) {
      handlePreDownloadDuplicate(directUrl, filename, fullPath);
      return;
    }

    const ws = fs.createWriteStream(fullPath);

    response.pipe(ws);
    ws.on("finish", () => {
      mainWindow?.webContents.send("download-done", {
        name: filename,
        filePath: fullPath,
      });

      // safe background hashing
      setTimeout(() => {
        registerFileHashes(fullPath).catch(console.error);
      }, 150);
    });

    ws.on("error", (err) => console.error("Drive download error:", err));
  });
}
