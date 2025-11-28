import fs from "fs";
import path from "path";
import crypto from "crypto";
import { app } from "electron";
import ssdeep from "ssdeep.js";
import { execFile } from "child_process";
import Tlsh from "tlsh";

/* ------------------------------------------------------- */
/*  DATABASE                                                */
/* ------------------------------------------------------- */

const DB_PATH = path.join(app.getPath("userData"), "hashes.json");

function ensureDB() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
  }
}

export function loadDB() {
  ensureDB();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveDB(db) {
  ensureDB();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

/* ------------------------------------------------------- */
/*  FULL SHA256 (SAFE STREAMING FOR LARGE FILES)           */
/* ------------------------------------------------------- */

export function computeSHA256(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(null);

    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });

    stream.on("data", async (chunk) => {
      hash.update(chunk);
      await new Promise((r) => setTimeout(r, 0)); // yield to avoid freeze
    });

    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", () => resolve(null));
  });
}

/* ------------------------------------------------------- */
/*  PARTIAL SHA256                                         */
/* ------------------------------------------------------- */

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

/* ------------------------------------------------------- */
/*  SSDEEP (FIXED API + SAFE READ)                         */
/* ------------------------------------------------------- */

export async function computeSsdeep(filePath) {
  try {
    const data = await fs.promises.readFile(filePath);
    return ssdeep.digest(data);
  } catch {
    return null;
  }
}

export function compareSsdeep(a, b) {
  try {
    return ssdeep.fuzzy_compare(a, b); // FINAL FIX
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- */
/*  SDHASH                                                  */
/* ------------------------------------------------------- */

const SDHASH_PATH =
  "C:\\Users\\vidit\\Desktop\\sdhash-4.0-win32\\sdhash-4.0-win32\\sdhash.exe";

export function computeSdhash(filePath) {
  return new Promise((resolve) => {
    execFile(SDHASH_PATH, [filePath], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      resolve(stdout.trim());
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

/* ------------------------------------------------------- */
/*  TLSH (SAFE STREAMING)                                  */
/* ------------------------------------------------------- */

export async function computeTLSH(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    const tl = new Tlsh();
    const stream = fs.createReadStream(filePath, { highWaterMark: 512 * 1024 });

    for await (const chunk of stream) {
      tl.update(chunk);
      await new Promise((r) => setTimeout(r, 0));
    }

    tl.final();
    return tl.hash();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- */
/*  DUPLICATE CHECK                                        */
/* ------------------------------------------------------- */

export async function checkHashExists(partial, ssdeepHash, sdhashHash, fileName = null) {
  const db = loadDB();

  // filename match
  if (fileName) {
    const found = Object.values(db).find(
      (e) => e.path && path.basename(e.path) === fileName
    );
    if (found) return { exists: true, path: found.path, type: "filename" };
  }

  // partial match
  if (partial) {
    for (const entry of Object.values(db)) {
      if (entry.partial === partial) {
        return { exists: true, path: entry.path, type: "partial" };
      }
    }
  }

  // SSDEEP fuzzy
  if (ssdeepHash) {
    for (const entry of Object.values(db)) {
      if (entry.ssdeep) {
        const score = compareSsdeep(ssdeepHash, entry.ssdeep);
        if (score !== null && score >= 80)
          return { exists: true, path: entry.path, type: "ssdeep", score };
      }
    }
  }

  // SDHASH fuzzy
  if (sdhashHash) {
    for (const entry of Object.values(db)) {
      if (entry.sdhash) {
        const score = await compareSdhash(sdhashHash, entry.sdhash);
        if (score !== null && score >= 90)
          return { exists: true, path: entry.path, type: "sdhash", score };
      }
    }
  }

  return { exists: false };
}

/* ------------------------------------------------------- */
/*  REGISTER NEW FILE SAFE                                 */
/* ------------------------------------------------------- */

export async function registerFileHashes(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  const partial = await computePartialSHA256(filePath);
  const sha = await computeSHA256(filePath);
  const sdeep = await computeSsdeep(filePath);
  const sd = await computeSdhash(filePath);
  const tl = await computeTLSH(filePath);

  const db = loadDB();

  db[sha] = {
    path: filePath,
    partial,
    ssdeep: sdeep,
    sdhash: sd,
    tlsh: tl,
  };

  saveDB(db);

  return { sha, partial };
}