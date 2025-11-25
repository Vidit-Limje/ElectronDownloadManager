import { contextBridge, ipcRenderer } from "electron";

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

  /** Fuzzy / exact duplicate detection */
  onDuplicate: (cb) => {
    const l = (_, data) => cb(data);
    ipcRenderer.on("duplicate-detected", l);
    return () => ipcRenderer.removeListener("duplicate-detected", l);
  },

  /** Continue / cancel feedback */
  sendDecision: (dupId, decision) => {
    ipcRenderer.send(`download-decision-${dupId}`, decision);
  },
});
