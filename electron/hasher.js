import fs from "fs";
import path from "path";
import crypto from "crypto";
import { app } from "electron";
import ssdeep from "ssdeep.js";
import { execFile } from "child_process";
import Tlsh from "tlsh";

/* ---------------------- SETTINGS ---------------------- */
// IMPORTANT: double backslashes in Windows path
const SDHASH_PATH =
  "C:\\Users\\vidit\\Downloads\\sdhash-4.0-win32\\sdhash-4.0-win32\\sdhash.exe";

const SSDEEP_THRESHOLD = 80; // 0–100
const SDHASH_THRESHOLD = 90; // 0–100

/* ---------------------- DATABASE ---------------------- */
const DB_DIR = app ? app.getPath("userData") : process.cwd();
const HASH_DB_PATH = path.join(DB_DIR, "hashes.json");

function ensureDBFile() {
  fs.mkdirSync(path.dirname(HASH_DB_PATH), { recursive: true });
  if (!fs.existsSync(HASH_DB_PATH)) {
    fs.writeFileSync(HASH_DB_PATH, JSON.stringify({}, null, 2), "utf8");
  }
}

function loadDB() {
  ensureDBFile();
  try {
    return JSON.parse(fs.readFileSync(HASH_DB_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveDB(db) {
  ensureDBFile();
  fs.writeFileSync(HASH_DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

/* ---------------------- PARTIAL SHA-256 ---------------------- */
export function computePartialSHA256(filePath, maxBytes = 1024 * 1024) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath, {
      start: 0,
      end: maxBytes - 1,
    });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", () => resolve(null));
  });
}

/* ---------------------- SHA-256 ---------------------- */
export function computeSHA256(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", () => resolve(null));
  });
}

/* ---------------------- TLSH (optional / not used for detection) ---------------------- */
export function computeTLSH(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    fs.readFile(filePath, (err, data) => {
      if (err || data.length < 256) return resolve(null);
      try {
        const hasher = new Tlsh();
        hasher.update(data);
        hasher.final();
        resolve(hasher.hash());
      } catch {
        resolve(null);
      }
    });
  });
}

export function compareTLSH(h1, h2) {
  try {
    return Tlsh.diff(h1, h2);
  } catch {
    return null;
  }
}

/* ---------------------- ssdeep ---------------------- */
export function computeSsdeep(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return ssdeep.digest(data);
  } catch {
    return null;
  }
}

export function compareSsdeep(h1, h2) {
  try {
    return ssdeep.compare(h1, h2); // 0–100
  } catch {
    return null;
  }
}

/* ---------------------- sdhash ---------------------- */
export function computeSdhash(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(null);

    // NOTE: depending on your sdhash build, you might need to adjust args.
    // This assumes: sdhash <file> → prints one line with hash.
    execFile(SDHASH_PATH, [filePath], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const line = stdout.split("\n")[0].trim();
      resolve(line || null);
    });
  });
}

export function compareSdhash(h1, h2) {
  return new Promise((resolve) => {
    execFile(SDHASH_PATH, ["-c", h1, h2], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const score = parseInt(stdout.trim(), 10);
      resolve(isNaN(score) ? null : score);
    });
  });
}

/* ---------------------- DUPLICATE CHECK ---------------------- */
/**
 * shaOrPartial: can be full sha256 OR partial sha256
 * ssdeepHash: ssdeep fuzzy hash
 * sdhashHash: sdhash fuzzy hash
 * fileName: optional filename check
 */
export async function checkHashExists(
  shaOrPartial,
  ssdeepHash,
  sdhashHash,
  fileName = null
) {
  const db = loadDB();

  // 1️⃣ Filename match
  if (fileName) {
    const entry = Object.values(db).find(
      (e) => e.path && path.basename(e.path) === fileName
    );
    if (entry) return { exists: true, path: entry.path, type: "filename" };
  }

  // 2️⃣ Exact SHA-256 or partial match
  if (shaOrPartial) {
    // full hash lookup
    if (db[shaOrPartial]) {
      return { exists: true, path: db[shaOrPartial].path, type: "exact" };
    }

    // partial hash lookup
    for (const entry of Object.values(db)) {
      if (entry.partial && entry.partial === shaOrPartial) {
        return { exists: true, path: entry.path, type: "partial" };
      }
    }
  }

  // 3️⃣ ssdeep fuzzy
  if (ssdeepHash) {
    for (const entry of Object.values(db)) {
      if (entry.ssdeep) {
        const score = compareSsdeep(ssdeepHash, entry.ssdeep);
        if (score !== null && score >= SSDEEP_THRESHOLD) {
          return { exists: true, path: entry.path, type: "ssdeep", score };
        }
      }
    }
  }

  // 4️⃣ sdhash fuzzy
  if (sdhashHash) {
    for (const entry of Object.values(db)) {
      if (entry.sdhash) {
        const score = await compareSdhash(sdhashHash, entry.sdhash);
        if (score !== null && score >= SDHASH_THRESHOLD) {
          return { exists: true, path: entry.path, type: "sdhash", score };
        }
      }
    }
  }

  return { exists: false };
}

/* ---------------------- REGISTER FILE ---------------------- */
export async function registerFileHashes(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  const partialHash = await computePartialSHA256(filePath);
  const sha256 = await computeSHA256(filePath);
  const ssdeepHash = computeSsdeep(filePath);
  const sdhashHash = await computeSdhash(filePath);
  const tlshHash = await computeTLSH(filePath);

  const db = loadDB();
  db[sha256] = {
    path: filePath,
    partial: partialHash,
    ssdeep: ssdeepHash,
    sdhash: sdhashHash,
    tlsh: tlshHash,
  };

  saveDB(db);

  return {
    sha256,
    partial: partialHash,
    ssdeep: ssdeepHash,
    sdhash: sdhashHash,
    tlsh: tlshHash,
    alreadyExists: false,
  };
}

export default {
  computePartialSHA256,
  computeSHA256,
  computeSsdeep,
  computeSdhash,
  computeTLSH,
  compareSsdeep,
  compareSdhash,
  compareTLSH,
  checkHashExists,
  registerFileHashes,
};
