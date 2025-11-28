import React, { useEffect, useState } from "react";

export default function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [dupModal, setDupModal] = useState(null);

  useEffect(() => {
    const unsubProgress = window.dm?.onProgress((p) => {
      setProgress(Number(p.percent));
      setStatus(`⬇️ Downloading ${p.name} — ${Number(p.percent).toFixed(2)}%`);
    });

    const unsubDone = window.dm?.onDone((d) => {
      setStatus(`✅ Download complete: ${d.name}`);
      setProgress(0);
    });

    const unsubError = window.dm?.onError(() => {
      setStatus(`❌ Download error`);
      setProgress(0);
    });

    const unsubDup = window.dm?.onDuplicate((data) => {
      setDupModal(data);
    });

    return () => {
      unsubProgress && unsubProgress();
      unsubDone && unsubDone();
      unsubError && unsubError();
      unsubDup && unsubDup();
    };
  }, []);

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
    if (action === "rename") setStatus("Saving as a new file...");
  };

  return (
    <div style={rootStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>⚡ Smart Download Manager</h1>

        {/* Input */}
        <div style={inputRowStyle}>
          <input
            style={inputStyle}
            placeholder="Paste file URL…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button style={btnBlue} onClick={startDownload}>
            Download
          </button>
        </div>

        {/* Status */}
        {status && <div style={statusBox}>{status}</div>}

        {/* Progress bar */}
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

      {/* Duplicate Modal */}
      {dupModal && (
        <DuplicateModal dupModal={dupModal} sendDecision={sendDecision} />
      )}
    </div>
  );
}

/* ----------------------------- MODAL ----------------------------- */

function DuplicateModal({ dupModal, sendDecision }) {
  return (
    <div style={modalOverlay}>
      <div style={modalBox}>
        <h2 style={{ marginTop: 0 }}>
          ⚠️ Duplicate File Detected
        </h2>

        <p>
          While downloading <b>{dupModal.name}</b>, an existing file was found.
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
            Save as New
          </button>
          <button style={btnOrange} onClick={() => sendDecision("overwrite")}>
            Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- STYLES ----------------------------- */

const rootStyle = {
  width: "100vw",
  height: "100vh",
  background: "#0f1115",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: 20,
  color: "white",
};

const cardStyle = {
  width: "100%",
  maxWidth: 700,
  padding: 40,
  borderRadius: 20,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 0 40px rgba(0,0,0,0.35)",
};

const titleStyle = {
  margin: 0,
  marginBottom: 20,
  fontSize: 30,
  fontWeight: "700",
};

const inputRowStyle = {
  display: "flex",
  gap: 10,
  marginBottom: 20,
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

const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

const modalBox = {
  width: 420,
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
