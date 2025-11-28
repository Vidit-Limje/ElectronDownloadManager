import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";
import { addHistoryEntry } from "./history.js";
import { rebuildHashDatabaseFromFolder } from "./hasher.js";
import { Worker } from "worker_threads";

import {
  computePartialSHA256,
  computeSsdeep,
  computeSdhash,
  checkHashExists,
  registerFileHashes,
} from "./hasher.js";

let mainWindow;
const PENDING = new Map(); // dupId -> { item, checkedPartial, savePath }
const PRE_DECISIONS = new Map(); // dupId -> { url, filename } for URL-initiated duplicates
const NEXT_SAVE_PATH = new Map(); // filename -> forced savePath to use in will-download
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log("🧩 Using preload:", path.join(__dirname, "preload.js"));
console.log("🧩 File exists:", fs.existsSync(path.join(__dirname, "preload.js")));

function createWindow() {
  mainWindow = new BrowserWindow({
  width: 900,
  height: 700,
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),   // ✅ FIXED
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
  
  ipcMain.handle("rebuild-hash-db", async () => {
  return new Promise((resolve) => {
    const folder = path.join(app.getPath("downloads"), "electron");
    const worker = new Worker(path.join(__dirname, "hashWorker.js"));

    worker.postMessage(folder);

    worker.on("message", (msg) => {
      if (msg.type === "progress") {
        mainWindow?.webContents.send("hash-progress", msg);
      }

      if (msg.type === "done") {
        saveDB(msg.db);
        resolve({ ok: true, count: Object.keys(msg.db).length });
      }
    });

    worker.on("error", (err) => {
      console.error("Worker crashed:", err);
      resolve({ ok: false, error: err.message });
    });
  });
});


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

    // Check if main process requested a forced savePath for this filename
    let savePath;
    if (NEXT_SAVE_PATH.has(filename)) {
      savePath = NEXT_SAVE_PATH.get(filename);
      NEXT_SAVE_PATH.delete(filename);
      // ensure directory exists
      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      console.log("ℹ️ Using forced save path for", filename, "=>", savePath);
    } else {
      savePath = path.join(electronFolder, filename);
    }

    // 🔥 Log filename duplicate
    if (!NEXT_SAVE_PATH.has(filename) && fs.existsSync(savePath)) {
      console.log("🚫 BLOCKED: Filename duplicate detected →", savePath);
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
            // Terminal logs for duplicate detection
            console.log("\n=======================================");
            console.log("⚠️  DUPLICATE DETECTED DURING DOWNLOAD");
            console.log("→ Type:", hit.type);
            console.log("→ Existing file:", hit.path);
            if (hit.score) console.log("→ Similarity score:", hit.score);
            console.log("=======================================\n");

            item.pause();

            // send dup info with dupId so UI can respond
            mainWindow?.webContents.send("duplicate-detected", {
              dupId,
              name: filename,
              existingPath: hit.path,
              matchType: hit.type,
              score: hit.score || null,
              partialHash: partialHash || null,
            });

            // handle UI decision for this in-progress download
            ipcMain.once(`download-decision-${dupId}`, async (_, decision) => {
              if (!decision) {
                console.log("❌ No decision received — cancelling.");
                item.cancel();
                fs.unlink(savePath, () => {});
                PENDING.delete(dupId);
                return;
              }

              if (decision.action === "overwrite") {
                console.log("📝 OVERWRITE requested — deleting existing and resuming.");
                try {
                  fs.unlinkSync(decision.existingPath);
                } catch (e) {
                  console.warn("Failed to delete existing file:", e);
                }
                item.setSavePath(decision.existingPath);
                item.resume();
                PENDING.delete(dupId);
                return;
              }

              if (decision.action === "rename") {
                console.log("📝 RENAME requested — generating new filename.");
                const base = path.basename(savePath, path.extname(savePath));
                const ext = path.extname(savePath);
                const dir = path.dirname(savePath);

                let counter = 1;
                let newPath = path.join(dir, `${base} (${counter})${ext}`);
                while (fs.existsSync(newPath)) {
                  counter++;
                  newPath = path.join(dir, `${base} (${counter})${ext}`);
                }

                console.log("📄 Renamed to:", newPath);
                item.setSavePath(newPath);
                item.resume();
                PENDING.delete(dupId);
                return;
              }

              if (decision.action === "skip") {
                console.log("🚫 SKIP requested — cancelling download.");
                item.cancel();
                fs.unlink(savePath, () => {});
                PENDING.delete(dupId);
                return;
              }

              // fallback: resume if continue
              if (decision.continue) {
                item.resume();
                PENDING.delete(dupId);
              } else {
                item.cancel();
                fs.unlink(savePath, () => {});
                PENDING.delete(dupId);
              }
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

  // If a file with this guessed name already exists, prompt user
  const electronFolder = path.join(app.getPath("downloads"), "electron");
  fs.mkdirSync(electronFolder, { recursive: true });
  const existingPath = path.join(electronFolder, nameToCheck);

  if (fs.existsSync(existingPath)) {
    // create dupId and store pre-decision state
    const dupId = `${Date.now()}-pre-${Math.random().toString(36).slice(2)}`;
    PRE_DECISIONS.set(dupId, { url, filename: nameToCheck, existingPath });

    console.log("🚫 Detected filename duplicate before start:", existingPath);
    mainWindow?.webContents.send("duplicate-detected", {
      dupId,
      name: nameToCheck,
      existingPath,
      matchType: "filename",
      partialHash: null,
    });

    // wait for UI decision
    ipcMain.once(`download-decision-${dupId}`, async (_, decision) => {
      PRE_DECISIONS.delete(dupId);

      if (!decision) {
        console.log("❌ No decision received for pre-download dup — skipping.");
        return;
      }

      if (decision.action === "overwrite") {
        console.log("📝 Pre-download OVERWRITE requested → deleting existing & starting download");
        try {
          fs.unlinkSync(existingPath);
        } catch (e) {
          console.warn("Failed to delete existing file (pre-overwrite):", e);
        }
        // set forced savePath to overwrite
        NEXT_SAVE_PATH.set(nameToCheck, existingPath);
        mainWindow?.webContents.downloadURL(url);
        return;
      }

      if (decision.action === "rename") {
        console.log("📝 Pre-download RENAME requested → generating new filename & starting download");

        const base = path.basename(existingPath, path.extname(existingPath));
        const ext = path.extname(existingPath);
        const dir = path.dirname(existingPath);

        let counter = 1;
        let newPath = path.join(dir, `${base} (${counter})${ext}`);
        while (fs.existsSync(newPath)) {
          counter++;
          newPath = path.join(dir, `${base} (${counter})${ext}`);
        }

        NEXT_SAVE_PATH.set(nameToCheck, newPath);
        mainWindow?.webContents.downloadURL(url);
        return;
      }

      if (decision.action === "skip") {
        console.log("🚫 Pre-download SKIP requested — not starting download.");
        return;
      }

      // fallback: if decision.continue true, just start download (will be blocked by filename unless NEXT_SAVE_PATH set)
      if (decision.continue) {
        // set forced path to a new variant to avoid blocking
        const base = path.basename(existingPath, path.extname(existingPath));
        const ext = path.extname(existingPath);
        const dir = path.dirname(existingPath);
        let counter = 1;
        let newPath = path.join(dir, `${base} (${counter})${ext}`);
        while (fs.existsSync(newPath)) {
          counter++;
          newPath = path.join(dir, `${base} (${counter})${ext}`);
        }
        NEXT_SAVE_PATH.set(nameToCheck, newPath);
        mainWindow?.webContents.downloadURL(url);
      }
      return;
    });

    return; // wait for decision
  }

  // No filename duplicate — proceed normally
  const hit = await checkHashExists(null, null, null, nameToCheck);
  if (hit.exists && hit.type === "filename") {
    console.log(
      "🚫 BLOCKED BEFORE START (filename duplicate):",
      nameToCheck,
      "→",
      hit.path
    );
    mainWindow?.webContents.send("duplicate-detected", {
      dupId: null,
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

    const electronFolder = path.join(app.getPath("downloads"), "electron");
    fs.mkdirSync(electronFolder, { recursive: true });
    const existingPath = path.join(electronFolder, filename);

    const exists = await checkHashExists(null, null, null, filename);
    if (exists?.exists || fs.existsSync(existingPath)) {
      const dupId = `${Date.now()}-pre-${Math.random().toString(36).slice(2)}`;
      PRE_DECISIONS.set(dupId, { url: directUrl, filename, existingPath });

      console.log("🚫 Google Drive filename duplicate →", existingPath);
      mainWindow?.webContents.send("duplicate-detected", {
        dupId,
        name: filename,
        existingPath,
        matchType: "filename",
      });

      ipcMain.once(`download-decision-${dupId}`, async (_, decision) => {
        PRE_DECISIONS.delete(dupId);
        if (!decision) return;
        if (decision.action === "overwrite") {
          try {
            fs.unlinkSync(existingPath);
          } catch (e) {}
          NEXT_SAVE_PATH.set(filename, existingPath);
          mainWindow?.webContents.downloadURL(directUrl);
        } else if (decision.action === "rename") {
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
          mainWindow?.webContents.downloadURL(directUrl);
        } else {
          // skip
          return;
        }
      });

      return;
    }

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
