import fs from "fs";
import path from "path";
import { app } from "electron";

const HISTORY_PATH = path.join(app.getPath("userData"), "history.json");

/* ------------------------------------------------------- */
/*  CATEGORY DETECTION                                     */
/* ------------------------------------------------------- */
function getCategory(filename) {
  const ext = filename.split(".").pop().toLowerCase();

  const media = ["mp4", "mkv", "avi", "mov", "mp3", "wav", "flac", "png", "jpg", "jpeg"];
  const documents = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"];

  if (media.includes(ext)) return "media";
  if (documents.includes(ext)) return "documents";
  return "others";
}

/* ------------------------------------------------------- */
/*  FILE SIZE SAFE READ                                    */
/* ------------------------------------------------------- */
function safeFileSize(filepath) {
  try {
    return fs.statSync(filepath).size;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------- */
/*  HISTORY FILE SETUP                                     */
/* ------------------------------------------------------- */
function ensureHistory() {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });

  if (!fs.existsSync(HISTORY_PATH)) {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify([], null, 2));
  }
}

export function loadHistory() {
  ensureHistory();
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
  } catch {
    return [];
  }
}

export function saveHistory(arr) {
  ensureHistory();
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(arr, null, 2));
}

/* ------------------------------------------------------- */
/*  ADD NEW ENTRY                                          */
/* ------------------------------------------------------- */
export function addHistoryEntry(filename, filepath) {
  const history = loadHistory();

  history.unshift({
    name: filename,
    filePath: filepath,

    size: safeFileSize(filepath),       // NEW
    category: getCategory(filename),    // NEW

    timestamp: Date.now(),
  });

  saveHistory(history);
  return history;
}
