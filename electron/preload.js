const { contextBridge, ipcRenderer } = require("electron");

console.log("🔥 preload loaded");

// Safely expose API to the UI
contextBridge.exposeInMainWorld("dm", {
  
  // Start download
  download: (url) => ipcRenderer.send("download", url),

  // Progress updates
  onProgress: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-progress", listener);
    return () => ipcRenderer.removeListener("download-progress", listener);
  },

  // Download complete
  onDone: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-done", listener);
    return () => ipcRenderer.removeListener("download-done", listener);
  },

  // Download error
  onError: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-error", listener);
    return () => ipcRenderer.removeListener("download-error", listener);
  },

  // Duplicate detection event
  onDuplicate: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("duplicate-detected", listener);
    return () =>
      ipcRenderer.removeListener("duplicate-detected", listener);
  },

  // NEW → Listen to history updates
  onHistory: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("history-updated", listener);
    return () =>
      ipcRenderer.removeListener("history-updated", listener);
  },

  // Send user decision on duplicate handling
  sendDecision: (dupId, payload) => {
    ipcRenderer.send(`download-decision-${dupId}`, payload);
  },

  rebuildHashDB: () => ipcRenderer.invoke("rebuild-hash-db"),
  onHashProgress: (cb) => {
  const listener = (_, data) => cb(data);
  ipcRenderer.on("hash-progress", listener);
  return () => ipcRenderer.removeListener("hash-progress", listener);
  },

});
