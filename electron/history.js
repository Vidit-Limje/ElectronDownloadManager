import fs from "fs";
import path from "path";
import { app } from "electron";

const DB_DIR = app ? app.getPath("userData") : process.cwd();
const HISTORY_PATH = path.join(DB_DIR, "history.json");

function ensureHistoryFile() {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  if (!fs.existsSync(HISTORY_PATH)) {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify([], null, 2));
  }
}

export function loadHistory() {
  ensureHistoryFile();
  return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
}

export function addHistoryEntry(entry) {
  ensureHistoryFile();
  const current = loadHistory();
  current.unshift(entry); // newest first
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(current, null, 2));
}
