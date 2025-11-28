// hashWorker.js
import { parentPort } from "worker_threads";
import fs from "fs";
import path from "path";

// Import ONLY worker-safe hashing functions
import {
  computePartialSHA256,
  computeSHA256,
  computeSsdeep,
  computeSdhash,
  computeTLSH
} from "./hasher-lite.js";

parentPort.on("message", async (folderPath) => {
  const db = {};

  // Read all files
  const files = fs.readdirSync(folderPath).filter((f) => {
    const full = path.join(folderPath, f);
    return fs.existsSync(full) && fs.statSync(full).isFile();
  });

  const total = files.length;
  let index = 0;

  for (const filename of files) {
    const filePath = path.join(folderPath, filename);

    index++;

    // ---- yield back to event loop to avoid freeze ----
    await new Promise((res) => setTimeout(res, 5));

    // ---- Perform hashing (heavy work) ----
    const partial = await computePartialSHA256(filePath);
    const sha256 = await computeSHA256(filePath);
    const ssdeepHash = computeSsdeep(filePath);
    const sdhashHash = await computeSdhash(filePath);
    const tlshHash = await computeTLSH(filePath);

    db[sha256] = {
      path: filePath,
      partial,
      ssdeep: ssdeepHash,
      sdhash: sdhashHash,
      tlsh: tlshHash,
    };

    // ---- Send progress back to main ----
    parentPort.postMessage({
      type: "progress",
      index,
      total,
      file: filePath,
    });
  }

  // ---- Final result ----
  parentPort.postMessage({
    type: "done",
    db,
  });
});
