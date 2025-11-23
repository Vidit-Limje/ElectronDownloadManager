import fs from "fs";
import crypto from "crypto";
import path from "path";
import { app } from "electron";
import Tlsh from "tlsh";

/* ---------------- Database Setup ---------------- */
const DB_DIR = app ? app.getPath("userData") : process.cwd();
const HASH_DB_PATH = path.join(DB_DIR, "hashes.json");

function ensureDBFile() {
  fs.mkdirSync(path.dirname(HASH_DB_PATH), { recursive: true });
  if (!fs.existsSync(HASH_DB_PATH)) {
    fs.writeFileSync(HASH_DB_PATH, JSON.stringify({}, null, 2), "utf8");
    console.log("🆕 Created new hash database at", HASH_DB_PATH);
  }
}

function loadDB() {
  ensureDBFile();
  try {
    const raw = fs.readFileSync(HASH_DB_PATH, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDB(db) {
  ensureDBFile();
  fs.writeFileSync(HASH_DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

/* ---------------- SHA-256 ---------------- */
export function computePartialSHA256(filePath, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath, { start: 0, end: Math.max(0, maxBytes - 1) });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function computeSHA256(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/* ---------------- TLSH ---------------- */
export function computeTLSH(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(null);

    fs.readFile(filePath, (err, data) => {
      if (err) return resolve(null);

      if (data.length < 256) {
        console.warn(`⚠️ TLSH skipped: ${path.basename(filePath)} too small (<256 bytes)`);
        return resolve(null);
      }

      try {
        const hasher = new Tlsh();
        hasher.update(data);
        hasher.final();
        resolve(hasher.hash());
      } catch (e) {
        if (e.message.includes("complexity")) {
          console.info(`ℹ️ TLSH skipped: ${path.basename(filePath)} lacks complexity`);
        } else {
          console.warn(`⚠️ TLSH compute error for ${path.basename(filePath)}:`, e.message);
        }
        resolve(null);
      }
    });
  });
}

export function compareTLSH(hash1, hash2) {
  if (!hash1 || !hash2) return null;
  try {
    return Tlsh.diff(hash1, hash2);
  } catch {
    return null;
  }
}

/* ---------------- Duplicate Check ---------------- */
export function checkHashExists(sha256, tlshHash, fileName = null, threshold = 30) {
  const db = loadDB();

  // 1️⃣ Filename check
  if (fileName) {
    const existing = Object.values(db).find(
      (entry) => entry.path && path.basename(entry.path) === fileName
    );
    if (existing) {
      return { exists: true, path: existing.path, type: "filename" };
    }
  }

  // 2️⃣ Exact match
  if (sha256 && db[sha256]) {
    const entry = db[sha256];
    return { exists: true, path: entry.path, type: "exact" };
  }

  // 3️⃣ Fuzzy match
  if (tlshHash) {
    for (const entry of Object.values(db)) {
      if (entry.tlsh) {
        const distance = compareTLSH(tlshHash, entry.tlsh);
        if (distance !== null && distance < threshold) {
          return { exists: true, path: entry.path, type: "fuzzy", distance };
        }
      }
    }
  }

  return { exists: false };
}

/* ---------------- Register File ---------------- */
export async function registerFileHashes(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  const sha256 = await computeSHA256(filePath);
  const tlshHash = await computeTLSH(filePath);
  const db = loadDB();

  if (db[sha256]) {
    console.log("ℹ️ File already registered:", path.basename(filePath));
    return { sha256, tlsh: tlshHash, alreadyExists: true };
  }

  db[sha256] = { path: filePath, tlsh: tlshHash || null };
  saveDB(db);

  console.log("🔐 Registered new file hash:", path.basename(filePath));
  return { sha256, tlsh: tlshHash, alreadyExists: false };
}

export default {
  computeSHA256,
  computeTLSH,
  compareTLSH,
  checkHashExists,
  registerFileHashes,
};
