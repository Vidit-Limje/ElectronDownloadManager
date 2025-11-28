// preload.js
const { contextBridge, ipcRenderer } = require("electron");

console.log("🔥 preload loaded");

/* ----------------------------------------------------- */
/*  SAFE API EXPOSED TO FRONTEND (window.dm)             */
/* ----------------------------------------------------- */

contextBridge.exposeInMainWorld("dm", {
  /* -------------------------------------------------- */
  /*  TRIGGER DOWNLOAD                                  */
  /* -------------------------------------------------- */
  download(url) {
    ipcRenderer.send("download", url);
  },

  /* -------------------------------------------------- */
  /*  DOWNLOAD PROGRESS                                 */
  /* -------------------------------------------------- */
  onProgress(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-progress", listener);
    return () =>
      ipcRenderer.removeListener("download-progress", listener);
  },

  /* -------------------------------------------------- */
  /*  DOWNLOAD COMPLETE                                 */
  /* -------------------------------------------------- */
  onDone(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-done", listener);
    return () =>
      ipcRenderer.removeListener("download-done", listener);
  },

  /* -------------------------------------------------- */
  /*  DOWNLOAD ERROR                                    */
  /* -------------------------------------------------- */
  onError(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-error", listener);
    return () =>
      ipcRenderer.removeListener("download-error", listener);
  },

  /* -------------------------------------------------- */
  /*  DUPLICATE POPUP                                   */
  /* -------------------------------------------------- */
  onDuplicate(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("duplicate-detected", listener);
    return () =>
      ipcRenderer.removeListener("duplicate-detected", listener);
  },

  /* -------------------------------------------------- */
  /*  SEND USER DECISION (rename/overwrite/skip)        */
  /* -------------------------------------------------- */
  sendDecision(dupId, payload) {
    if (!dupId) {
      console.warn("⚠ sendDecision called with NULL dupId – ignored.");
      return;
    }

    ipcRenderer.send(`download-decision-${dupId}`, payload);
  },

  /* -------------------------------------------------- */
  /*  DOWNLOAD START EVENT (optional)                   */
  /* -------------------------------------------------- */
  onStart(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("download-started", listener);
    return () =>
      ipcRenderer.removeListener("download-started", listener);
  },

  /* -------------------------------------------------- */
  /*  HISTORY LISTENER (for UI history tab)             */
  /* -------------------------------------------------- */
  onHistory(cb) {
    const listener = (_, data) => cb(data);
    ipcRenderer.on("history-updated", listener);
    return () =>
      ipcRenderer.removeListener("history-updated", listener);
  },

  /* -------------------------------------------------- */
  /*  REQUEST HISTORY                                   */
  /* -------------------------------------------------- */
  getHistory() {
    return ipcRenderer.invoke("get-history");
  },
});
