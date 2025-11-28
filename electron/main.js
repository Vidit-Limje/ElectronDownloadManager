// main.js
import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";

// hashing imports
import {
  computePartialSHA256,
  computeSsdeep,
  checkHashExists,
  registerFileHashes,
} from "./hasher.js";

let mainWindow;

const PENDING = new Map();
const PRE_DECISIONS = new Map();

// IMPORTANT: renamed save paths stored by dupId
const NEXT_SAVE_PATH = new Map();

// ---------- HISTORY SYSTEM ----------
const HISTORY_PATH = path.join(app.getPath("userData"), "history.json");

function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveHistory(list) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(list, null, 2));
}

function addHistoryEntry(name, filePath) {
  const list = loadHistory();

  list.unshift({
    name,
    filePath,
    timestamp: Date.now(),
  });

  saveHistory(list);

  // Notify frontend
  if (mainWindow) {
    mainWindow.webContents.send("history-updated", list);
  }
}
// ------------------------------------

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
          console.error("❌ Bad extension POST:", e);
        }
        res.writeHead(400).end("bad request");
      });
    } else res.writeHead(404).end("not found");
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
  setupHistoryHandlers();      // <-- ADDED
  setupDownloadManager();
});

/* ------------------------------------------------------- */
/* HISTORY IPC HANDLERS                                     */
/* ------------------------------------------------------- */
function setupHistoryHandlers() {
  ipcMain.handle("get-history", async () => {
    return loadHistory();
  });
}

/* ------------------------------------------------------- */
/* UI TRIGGERED DOWNLOAD                                   */
/* ------------------------------------------------------- */
function setupIPCDownloadTrigger() {
  ipcMain.on("download", (_, url) => url && handleDownload(url));
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

    let savePath = NEXT_SAVE_PATH.get(dupId);
    const originalPath = path.join(downloadsFolder, filename);

    if (!savePath) savePath = originalPath;

    // block only original name duplicates
    if (savePath === originalPath && fs.existsSync(originalPath)) {
      console.log("🚫 Filename duplicate:", originalPath);

      mainWindow?.webContents.send("duplicate-detected", {
        dupId: null,
        name: filename,
        existingPath: originalPath,
        matchType: "filename",
      });

      event.preventDefault();
      return;
    }

    item.setSavePath(savePath);

    PENDING.set(dupId, {
      item,
      savePath,
      checkedPartial: false,
    });

    /* --------------------------------------------------- */
    /* PROGRESS                                            */
    /* --------------------------------------------------- */
    item.on("updated", async () => {
      const st = PENDING.get(dupId);
      if (!st) return;

      const received = item.getReceivedBytes();
      const total = item.getTotalBytes();
      const percent = total ? ((received / total) * 100).toFixed(2) : "0";

      mainWindow?.webContents.send("download-progress", {
        name: filename,
        received,
        total,
        percent,
      });

      // partial duplicate check
      if (!st.checkedPartial && received >= 1024 * 1024) {
        st.checkedPartial = true;

        try {
          const partial = await computePartialSHA256(st.savePath);
          const sdeep = await computeSsdeep(st.savePath);

          const hit = await checkHashExists(partial, sdeep, null);

          if (hit.exists) {
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
              st.savePath,
              filename,
              hit
            );
          }
        } catch (err) {
          console.log("Partial dup error:", err);
        }
      }
    });

    /* --------------------------------------------------- */
    /* COMPLETE / FAIL                                     */
/* --------------------------------------------------- */
    item.once("done", async (_, state) => {
      const finalPath = item.getSavePath();

      if (state === "completed") {
        mainWindow?.webContents.send("download-done", {
          filePath: finalPath,
          name: filename,
        });

        // ADD TO HISTORY ---------------------
        addHistoryEntry(filename, finalPath);

        setTimeout(() => {
          registerFileHashes(finalPath).catch(console.error);
        }, 150);
      } else {
        mainWindow?.webContents.send("download-error", { state });
      }

      PENDING.delete(dupId);
      NEXT_SAVE_PATH.delete(dupId);
    });
  });
}

/* ------------------------------------------------------- */
/* DUP DECISION HANDLER DURING DOWNLOAD                    */
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
      const dir = path.dirname(savePath);
      const base = path.basename(savePath, path.extname(savePath));
      const ext = path.extname(savePath);

      let counter = 1;
      let newPath = path.join(dir, `${base} (${counter})${ext}`);

      while (fs.existsSync(newPath)) {
        counter++;
        newPath = path.join(dir, `${base} (${counter})${ext}`);
      }

      NEXT_SAVE_PATH.set(dupId, newPath);

      item.setSavePath(newPath);
      item.resume();
      return;
    }

    if (decision.action === "skip") {
      item.cancel();
      fs.unlink(savePath, () => {});
      return;
    }

    item.resume();
  });
}

/* ------------------------------------------------------- */
/* URL DOWNLOAD STARTER                                    */
/* ------------------------------------------------------- */
async function handleDownload(url) {
  const guessedName = path.basename(new URL(url).pathname || "unknown");
  const folder = path.join(app.getPath("downloads"), "electron");
  fs.mkdirSync(folder, { recursive: true });

  const filePath = path.join(folder, guessedName);

  if (fs.existsSync(filePath)) {
    handlePreDownloadDuplicate(url, guessedName, filePath);
    return;
  }

  mainWindow?.webContents.downloadURL(url);
}

/* ------------------------------------------------------- */
/* PRE-DOWNLOAD DUP HANDLER                                */
/* ------------------------------------------------------- */
function handlePreDownloadDuplicate(url, filename, existingPath) {
  const dupId = `${Date.now()}-pre-${Math.random().toString(36).slice(2)}`;

  mainWindow?.webContents.send("duplicate-detected", {
    dupId,
    name: filename,
    existingPath,
    matchType: "filename",
  });

  ipcMain.once(`download-decision-${dupId}`, (_, decision) => {
    if (!decision) return;

    const dir = path.dirname(existingPath);
    const base = path.basename(existingPath, path.extname(existingPath));
    const ext = path.extname(existingPath);

    if (decision.action === "overwrite") {
      try {
        fs.unlinkSync(existingPath);
      } catch {}
      NEXT_SAVE_PATH.set(dupId, existingPath);
      mainWindow?.webContents.downloadURL(url);
      return;
    }

    if (decision.action === "rename") {
      let counter = 1;
      let newPath = path.join(dir, `${base} (${counter})${ext}`);

      while (fs.existsSync(newPath)) {
        counter++;
        newPath = path.join(dir, `${base} (${counter})${ext}`);
      }

      NEXT_SAVE_PATH.set(dupId, newPath);
      mainWindow?.webContents.downloadURL(url);
      return;
    }
  });
}
