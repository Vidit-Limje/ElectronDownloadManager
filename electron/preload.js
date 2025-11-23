// electron/preload.js
import { contextBridge, ipcRenderer } from "electron";

/**
 * Secure bridge between renderer (React) and Electron main process.
 * Exposes controlled download manager APIs.
 */
contextBridge.exposeInMainWorld("dm", {
  /** Trigger download from renderer */
  download: (url) => ipcRenderer.send("download", url),

  /** Listen to download progress updates */
  onProgress: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-progress", listener);
    return () => ipcRenderer.removeListener("download-progress", listener);
  },

  /** Listen for successful completion */
  onDone: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-done", listener);
    return () => ipcRenderer.removeListener("download-done", listener);
  },

  /** Listen for download errors */
  onError: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-error", listener);
    return () => ipcRenderer.removeListener("download-error", listener);
  },

  /**
   * Listen for duplicate or fuzzy match detection.
   * Data payload:
   * {
   *   dupId: string,
   *   name: string,
   *   partialHash: string,
   *   existingPath: string,
   *   matchType: "exact" | "fuzzy",
   *   distance?: number | null
   * }
   */
  onDuplicate: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("duplicate-detected", listener);
    return () => ipcRenderer.removeListener("duplicate-detected", listener);
  },

  /** Send user decision (continue / cancel) back to main */
  sendDecision: (dupId, decision) => {
    ipcRenderer.send(`download-decision-${dupId}`, decision);
  },
});
