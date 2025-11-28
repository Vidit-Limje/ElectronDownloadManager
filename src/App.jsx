import React, { useEffect, useState } from "react";

export default function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [dupModal, setDupModal] = useState(null);

  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("download");

  // NEW STATES
  const [hashProgress, setHashProgress] = useState(null);
  const [isRebuilding, setIsRebuilding] = useState(false);

  useEffect(() => {
    const unsubProgress = window.dm?.onProgress((p) => {
      setProgress(Number(p.percent));
      setStatus(`Downloading ${p.name} — ${Number(p.percent).toFixed(2)}%`);
    });

    const unsubDone = window.dm?.onDone((d) => {
      setStatus(`✅ Download complete: ${d.name || d.filePath}`);
      setProgress(0);
    });

    const unsubError = window.dm?.onError(() => {
      setStatus(`❌ Download error`);
      setProgress(0);
    });

    const unsubDup = window.dm?.onDuplicate((data) => {
      setDupModal(data);
    });

    const unsubHistory = window.dm?.onHistory((data) => {
      setHistory(data);
    });

    // NEW — Hash rebuild progress
    const unsubHashProgress = window.dm?.onHashProgress((p) => {
      setIsRebuilding(true);
      setHashProgress(p);
      setStatus(`Hashing ${p.index}/${p.total}: ${p.file}`);
    });

    return () => {
      unsubProgress && unsubProgress();
      unsubDone && unsubDone();
      unsubError && unsubError();
      unsubDup && unsubDup();
      unsubHistory && unsubHistory();
      unsubHashProgress && unsubHashProgress();
    };
  }, []);

  const startDownload = () => {
    if (!url.trim()) return alert("Enter URL");
    setStatus("Starting download...");
    window.dm?.download(url);
  };

  const rebuildHashDB = async () => {
    setIsRebuilding(true);
    setHashProgress(null);
    setStatus("🔄 Starting full hash rebuild...");

    const result = await window.dm.rebuildHashDB();

    setStatus(`✔️ Hash DB rebuilt for ${result.count} files`);
    setIsRebuilding(false);
    setHashProgress(null);
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
    else if (action === "overwrite") setStatus("Overwriting existing file...");
    else setStatus("Saving as new file...");
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0f1115",
        display: "flex",
        flexDirection: "column",
        padding: 20,
        color: "white",
        boxSizing: "border-box",
      }}
    >
      {/* Tabs */}
      <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
        <div
          style={tabStyle(activeTab === "download")}
          onClick={() => setActiveTab("download")}
        >
          📥 Download Manager
        </div>

        <div
          style={tabStyle(activeTab === "history")}
          onClick={() => setActiveTab("history")}
        >
          📚 History
        </div>
      </div>

      {/* ----------- DOWNLOAD MANAGER ----------- */}
      {activeTab === "download" && (
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <div style={cardStyle}>
            <h1 style={titleStyle}>⚡ Smart Duplicate-Aware Download Manager</h1>

            {/* Input */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <input
                style={inputStyle}
                placeholder="Paste file URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button style={btnBlue} onClick={startDownload}>
                Download
              </button>
            </div>

            {/* NEW BUTTON — REBUILD HASH DB */}
            <div style={{ marginTop: 10 }}>
              <button
                style={{
                  ...btnBlue,
                  background: isRebuilding ? "#065f46" : "#10b981",
                  opacity: isRebuilding ? 0.6 : 1,
                  cursor: isRebuilding ? "not-allowed" : "pointer",
                }}
                disabled={isRebuilding}
                onClick={rebuildHashDB}
              >
                {isRebuilding ? "⏳ Rebuilding..." : "🔄 Rebuild Hash Database"}
              </button>
            </div>

            {/* Status Box */}
            {status && <div style={statusBox}>{status}</div>}

            {/* Hash Rebuild Progress */}
            {hashProgress && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 14, opacity: 0.9 }}>
                  Processing file {hashProgress.index} of {hashProgress.total}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  {hashProgress.file}
                </div>
              </div>
            )}

            {/* Download progress bar */}
            {progress > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={progressOuter}>
                  <div style={{ ...progressInner, width: `${progress}%` }}></div>
                </div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  {progress.toFixed(2)}%
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------- HISTORY TAB ----------- */}
      {activeTab === "history" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={historyListStyle}>
            {history.length === 0 && (
              <div style={{ opacity: 0.5 }}>No downloads yet</div>
            )}

            {history.map((item, idx) => (
              <div key={idx} style={historyItem}>
                <div style={{ fontWeight: 600 }}>{item.filename}</div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  {item.filepath}
                </div>
                <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
                  {new Date(item.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {dupModal && (
        <DuplicateModal dupModal={dupModal} sendDecision={sendDecision} />
      )}
    </div>
  );
}

/* ----------------------------- COMPONENTS ----------------------------- */

function DuplicateModal({ dupModal, sendDecision }) {
  return (
    <div style={modalOverlay}>
      <div style={modalBox}>
        <h2>
          ⚠️ {dupModal.matchType === "fuzzy"
            ? "Similar File Found"
            : "Duplicate File Detected"}
        </h2>

        <p>
          While downloading <b>{dupModal.name}</b>, a matching file was found.
        </p>

        <p style={{ opacity: 0.8 }}>
          Existing file:
          <br />
          <code style={{ fontSize: 13 }}>{dupModal.existingPath}</code>
        </p>

        {dupModal.score != null && (
          <p>
            Similarity score: <b>{dupModal.score}%</b>
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

/* ----------------------------- STYLES (unchanged except where needed) ----------------------------- */

const cardStyle = {
  width: "100%",
  maxWidth: 900,
  padding: 40,
  borderRadius: 20,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  boxShadow: "0 0 40px rgba(0,0,0,0.35)",
};

const titleStyle = {
  margin: 0,
  marginBottom: 20,
  color: "white",
  fontSize: 30,
  fontWeight: "700",
};

const inputStyle = {
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
  background: "rgba(255,255,255,0.06)",
  borderRadius: 12,
  color: "#d1d5db",
  marginBottom: 12,
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

const historyListStyle = {
  width: "100%",
  maxWidth: 900,
  margin: "0 auto",
  padding: "10px 0",
};

const historyItem = {
  background: "#1a1c21",
  padding: 14,
  borderRadius: 10,
  border: "1px solid #333",
  marginBottom: 10,
};

const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

const modalBox = {
  width: 480,
  padding: 30,
  background: "#1b1d22",
  borderRadius: 16,
  color: "white",
};

const modalActions = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 20,
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

function tabStyle(active) {
  return {
    padding: "12px 20px",
    borderRadius: 10,
    background: active ? "#1a1c21" : "rgba(255,255,255,0.05)",
    border: active ? "1px solid #3b82f6" : "1px solid transparent",
    cursor: "pointer",
    fontWeight: 600,
  };
}
