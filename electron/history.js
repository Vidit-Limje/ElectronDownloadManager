import fs from "fs";
import path from "path";
import { app } from "electron";

const HISTORY_PATH = path.join(app.getPath("userData"), "history.json");

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

export function addHistoryEntry(filename, filepath) {
  const history = loadHistory();

  history.unshift({
    filename,
    filepath,
    timestamp: Date.now(),
  });

  saveHistory(history);

  return history;
}