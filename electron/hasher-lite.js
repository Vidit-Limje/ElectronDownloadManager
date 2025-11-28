import fs from "fs";
import crypto from "crypto";
import ssdeep from "ssdeep.js";
import { execFile } from "child_process";
import Tlsh from "tlsh";

const SDHASH_PATH =
  "C:\\Users\\vidit\\Downloads\\sdhash-4.0-win32\\sdhash-4.0-win32\\sdhash.exe";

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

export function computeSsdeep(filePath) {
  try {
    return ssdeep.digest(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

export function computeSdhash(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(null);

    execFile(SDHASH_PATH, [filePath], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      resolve(stdout.split("\n")[0].trim());
    });
  });
}

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
