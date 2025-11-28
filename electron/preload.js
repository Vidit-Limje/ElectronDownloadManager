import { contextBridge, ipcRenderer } from "electron";
console.log("🔥 preload loaded");

contextBridge.exposeInMainWorld("dm", {
  download: (url) => ipcRenderer.send("download", url),

  onProgress: (cb) => {
    const l = (_, d) => cb(d);
    ipcRenderer.on("download-progress", l);
    return () => ipcRenderer.removeListener("download-progress", l);
  },

  onDone: (cb) => {
    const l = (_, d) => cb(d);
    ipcRenderer.on("download-done", l);
    return () => ipcRenderer.removeListener("download-done", l);
  },

  onError: (cb) => {
    const l = (_, d) => cb(d);
    ipcRenderer.on("download-error", l);
    return () => ipcRenderer.removeListener("download-error", l);
  },

  /** Duplicate detection event */
  onDuplicate: (cb) => {
    const l = (_, data) => cb(data);
    ipcRenderer.on("duplicate-detected", l);
    return () => ipcRenderer.removeListener("duplicate-detected", l);
  },

  /** Send user decision (action object) back to main */
  sendDecision: (dupId, data) => {
    ipcRenderer.send(`download-decision-${dupId}`, data);
  },
});
