// preload.js
const { contextBridge, ipcRenderer } = require("electron");

// Debug
console.log("🔥 preload loaded");

/* ----------------------------------------------------- */
/*  SAFE API EXPOSED TO WINDOW.dm                        */
/* ----------------------------------------------------- */

contextBridge.exposeInMainWorld("dm", {
  /* -------------------------------------------------- */
  /*  DOWNLOAD TRIGGER                                  */
  /* -------------------------------------------------- */

  download: (url) => ipcRenderer.send("download", url),

  /* -------------------------------------------------- */
  /*  DOWNLOAD PROGRESS                                 */
  /* -------------------------------------------------- */

  onProgress(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-progress", listener);
    return () => ipcRenderer.removeListener("download-progress", listener);
  },

  onDone(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-done", listener);
    return () => ipcRenderer.removeListener("download-done", listener);
  },

  onError(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-error", listener);
    return () => ipcRenderer.removeListener("download-error", listener);
  },

  /* -------------------------------------------------- */
  /*  DUPLICATE HANDLER                                 */
  /* -------------------------------------------------- */

  onDuplicate(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("duplicate-detected", listener);
    return () =>
      ipcRenderer.removeListener("duplicate-detected", listener);
  },

  sendDecision(dupId, payload) {
    ipcRenderer.send(`download-decision-${dupId}`, payload);
  },

  /* -------------------------------------------------- */
  /* OPTIONAL: DOWNLOAD STARTED                         */
  /* -------------------------------------------------- */

  onStart(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-started", listener);
    return () => ipcRenderer.removeListener("download-started", listener);
  },

});
