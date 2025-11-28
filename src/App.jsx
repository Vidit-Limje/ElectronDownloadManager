import React, { useEffect, useState } from "react";

export default function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [dupModal, setDupModal] = useState(null);

  const [activeTab, setActiveTab] = useState("download");
  const [history, setHistory] = useState([]);

  // >>> NEW
  const [currentDupId, setCurrentDupId] = useState(null);
  const [isPaused, setIsPaused] = useState(false);

  /* -------------------------------------------------- */
  /*  IPC LISTENERS                                     */
  /* -------------------------------------------------- */
  useEffect(() => {
    const unsubProgress = window.dm?.onProgress((p) => {
      setProgress(Number(p.percent));
      setStatus(`Downloading ${p.name} – ${Number(p.percent).toFixed(2)}%`);
      setCurrentDupId(p.dupId || null); // >>> NEW
    });

    const unsubDone = window.dm?.onDone((d) => {
      setStatus(`✔ Download complete: ${d.name}`);
      setProgress(0);
      setCurrentDupId(null); // >>> NEW
      setIsPaused(false); // >>> NEW
    });

    const unsubError = window.dm?.onError(() => {
      setStatus(`❌ Download error`);
      setProgress(0);
      setCurrentDupId(null); // >>> NEW
      setIsPaused(false);
    });

    const unsubDup = window.dm?.onDuplicate((data) => {
      setDupModal(data);
      setCurrentDupId(data.dupId || null); // >>> NEW
    });

    const unsubHistory = window.dm?.onHistory((list) => {
      setHistory(list);
    });

    window.dm?.getHistory().then((list) => setHistory(list || []));

    return () => {
      unsubProgress?.();
      unsubDone?.();
      unsubError?.();
      unsubDup?.();
      unsubHistory?.();
    };
  }, []);

  /* -------------------------------------------------- */
  /*  HANDLERS                                          */
  /* -------------------------------------------------- */
  const startDownload = () => {
    if (!url.trim()) return alert("Enter URL");
    setStatus("Starting download...");
    window.dm?.download(url);
  };

  const sendDecision = (action) => {
    if (!dupModal) return;

    const payload =
      action === "overwrite"
        ? { action: "overwrite", existingPath: dupModal.existingPath }
        : { action };

    window.dm?.sendDecision(dupModal.dupId, payload);

    setDupModal(null);
    if (action === "skip") setStatus("Download cancelled");
    if (action === "overwrite") setStatus("Overwriting existing file...");
    if (action === "rename") setStatus("Saving file as new...");
  };

  // >>> NEW: Pause / Resume / Cancel controls
  const pauseDownload = () => {
    if (!currentDupId) return;
    window.dm.pause(currentDupId);
    setIsPaused(true);
    setStatus("⏸ Download paused");
  };

  const resumeDownload = () => {
    if (!currentDupId) return;
    window.dm.resume(currentDupId);
    setIsPaused(false);
    setStatus("▶ Download resumed");
  };

  const cancelDownload = () => {
    if (!currentDupId) return;
    window.dm.cancel(currentDupId);
    setIsPaused(false);
    setStatus("❌ Download cancelled");
    setProgress(0);
  };

  /* -------------------------------------------------- */
  /*  RENDER                                            */
  /* -------------------------------------------------- */
  return (
    <div style={layout}>
      {/* LEFT SIDEBAR */}
      <div style={sidebar}>
        <div
          style={tab(activeTab === "download")}
          onClick={() => setActiveTab("download")}
        >
          📥 Downloads
        </div>

        <div
          style={tab(activeTab === "history")}
          onClick={() => setActiveTab("history")}
        >
          📚 History
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={content}>
        {activeTab === "download" && (
          <DownloadUI
            url={url}
            setUrl={setUrl}
            startDownload={startDownload}
            status={status}
            progress={progress}
            dupId={currentDupId}        // >>> NEW
            isPaused={isPaused}         // >>> NEW
            pause={pauseDownload}       // >>> NEW
            resume={resumeDownload}     // >>> NEW
            cancel={cancelDownload}     // >>> NEW
          />
        )}

        {activeTab === "history" && <HistoryUI history={history} />}
      </div>

      {dupModal && (
        <DuplicateModal dupModal={dupModal} sendDecision={sendDecision} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------- */
/*  DOWNLOAD PAGE UI                                          */
/* ---------------------------------------------------------- */

function DownloadUI({ url, setUrl, startDownload, status, progress, dupId, isPaused, pause, resume, cancel }) {
  return (
    <div style={card}>
      <h1 style={title}>⚡ Smart Duplicate-Aware Downloader</h1>

      <div style={inputRow}>
        <input
          style={input}
          placeholder="Paste file URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button style={btnBlue} onClick={startDownload}>
          Download
        </button>
      </div>

      {status && <div style={statusBox}>{status}</div>}

      {progress > 0 && (
        <>
          <div style={{ marginTop: 10 }}>
            <div style={progressOuter}>
              <div style={{ ...progressInner, width: `${progress}%` }} />
            </div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              {progress.toFixed(2)}%
            </div>
          </div>

          {/* >>> NEW: Pause/Resume/Cancel buttons */}
          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            {!isPaused && (
              <button style={btnOrange} onClick={pause}>
                ⏸ Pause
              </button>
            )}
            {isPaused && (
              <button style={btnBlue} onClick={resume}>
                ▶ Resume
              </button>
            )}
            <button style={btnRed} onClick={cancel}>
              ❌ Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- */
/*  HISTORY + MODAL (unchanged)                              */
/* ---------------------------------------------------------- */

function HistoryUI({ history }) {
  return (
    <div style={historyWrapper}>
      <h2 style={{ marginBottom: 20 }}>📚 Download History</h2>

      {history.length === 0 && (
        <div style={{ opacity: 0.5 }}>No downloads yet.</div>
      )}

      {history.map((item, idx) => (
        <div key={idx} style={historyItem}>
          <div style={{ fontWeight: "600" }}>{item.name}</div>

          <div style={{ fontSize: 13, opacity: 0.8 }}>{item.filePath}</div>

          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
            {new Date(item.timestamp).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- */
/*  DUPLICATE MODAL (unchanged)                              */
/* ---------------------------------------------------------- */

function DuplicateModal({ dupModal, sendDecision }) {
  return (
    <div style={modalOverlay}>
      <div style={modalBox}>
        <h2 style={{ marginTop: 0 }}>
          ⚠️ {dupModal.matchType === "filename" ? "Duplicate File" : "Similar File"}
        </h2>

        <p>
          A file matching <b>{dupModal.name}</b> already exists.
        </p>

        <p style={{ opacity: 0.8 }}>
          Path:
          <br />
          <code style={{ fontSize: 13 }}>{dupModal.existingPath}</code>
        </p>

        {dupModal.score != null && (
          <p>
            Similarity Score: <b>{dupModal.score}%</b>
          </p>
        )}

        <div style={modalActions}>
          <button style={btnRed} onClick={() => sendDecision("skip")}>
            Skip
          </button>
          <button style={btnBlue} onClick={() => sendDecision("rename")}>
            Save New
          </button>
          <button style={btnOrange} onClick={() => sendDecision("overwrite")}>
            Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- */
/*  STYLES (unchanged)                                        */
/* ---------------------------------------------------------- */

const layout = {
  display: "flex",
  width: "100vw",
  height: "100vh",
  fontFamily: "Inter, sans-serif",
  background: "#0f1115",
  color: "white",
};

const sidebar = {
  width: 180,
  padding: "20px 10px",
  background: "rgba(255,255,255,0.04)",
  borderRight: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const tab = (active) => ({
  padding: "12px 16px",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 600,
  background: active ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.04)",
  border: active ? "1px solid #3b82f6" : "1px solid transparent",
});

const content = {
  flex: 1,
  padding: 35,
  overflowY: "auto",
};

const card = {
  width: "100%",
  maxWidth: 650,
  padding: 40,
  borderRadius: 20,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 0 40px rgba(0,0,0,0.35)",
};

const title = {
  margin: 0,
  marginBottom: 20,
  fontSize: 28,
  fontWeight: 700,
};

const inputRow = {
  display: "flex",
  gap: 10,
  marginBottom: 20,
};

const input = {
  flex: 1,
  padding: 14,
  fontSize: 16,
  borderRadius: 10,
  border: "1px solid #333",
  background: "#1a1c21",
  color: "white",
};

const statusBox = {
  padding: 16,
  background: "rgba(255,255,255,0.07)",
  borderRadius: 10,
  marginBottom: 10,
};

const progressOuter = {
  width: "100%",
  height: 8,
  background: "#222",
  borderRadius: 4,
  overflow: "hidden",
};

const progressInner = {
  height: "100%",
  background: "#3b82f6",
  transition: "width 0.2s",
};

const historyWrapper = {
  maxWidth: 700,
  margin: "0 auto",
};

const historyItem = {
  background: "rgba(255,255,255,0.05)",
  padding: 14,
  borderRadius: 12,
  marginBottom: 10,
  border: "1px solid rgba(255,255,255,0.07)",
};

const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  backdropFilter: "blur(4px)",
};

const modalBox = {
  width: 420,
  padding: 30,
  background: "rgba(27,29,34,0.95)",
  borderRadius: 18,
  color: "white",
  boxShadow: "0px 0px 25px rgba(0,0,0,0.35)",
};

const modalActions = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 20,
  gap: 10,
};

const btnBlue = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  background: "#3b82f6",
  color: "white",
  fontWeight: 600,
};

const btnRed = { ...btnBlue, background: "#ef4444" };
const btnOrange = { ...btnBlue, background: "#f59e0b" };
