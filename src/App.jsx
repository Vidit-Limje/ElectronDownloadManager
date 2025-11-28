import React, { useEffect, useState } from "react";

export default function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);

  // Modal data from duplicate-detected event
  const [dupModal, setDupModal] = useState(null);
  // dupModal = { dupId, name, partialHash, existingPath, matchType, score }

  useEffect(() => {
    // progress/done/error listeners
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
      // data may have dupId null for immediate filename-only detection in will-download
      setDupModal(data);
    });

    return () => {
      unsubProgress && unsubProgress();
      unsubDone && unsubDone();
      unsubError && unsubError();
      unsubDup && unsubDup();
    };
  }, []);

  function startDownload() {
    if (!url.trim()) return alert("Enter URL");
    setStatus("Starting download...");
    window.dm?.download(url);
  }

  function sendDecision(action) {
    if (!dupModal) return;
    // action: "overwrite" | "rename" | "skip"
    const payload =
      action === "overwrite"
        ? { action: "overwrite", existingPath: dupModal.existingPath }
        : { action };
    window.dm?.sendDecision(dupModal.dupId, payload);
    setDupModal(null);
    if (action === "skip") setStatus("Download cancelled");
    else if (action === "overwrite") setStatus("Overwriting existing file...");
    else if (action === "rename") setStatus("Saving as new file...");
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h2>Duplicate File Download Manager</h2>

      <div style={{ marginBottom: 12 }}>
        <input
          style={{ width: 420, padding: 8 }}
          placeholder="Paste file URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          style={{ marginLeft: 8, padding: "8px 12px" }}
          onClick={startDownload}
        >
          Download
        </button>
      </div>

      <div>
        <div style={{ marginTop: 8 }}>{status}</div>
        {progress > 0 && (
          <div style={{ marginTop: 8 }}>
            <progress value={progress} max="100" style={{ width: 420 }} />
            <div>{Number(progress).toFixed(2)}%</div>
          </div>
        )}
      </div>

      {/* Duplicate / Similar modal */}
      {dupModal && (
        <div
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: 24,
              borderRadius: 10,
              width: 560,
              boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              {dupModal.matchType === "fuzzy"
                ? "⚠️ Similar File Detected"
                : "⚠️ Duplicate File Detected"}
            </h3>

            <p>
              While downloading <strong>{dupModal.name}</strong>,{" "}
              {dupModal.matchType === "fuzzy"
                ? "a file with high similarity"
                : "an existing file"}{" "}
              was found on your system.
            </p>

            {dupModal.score != null && (
              <p>
                Similarity score: <strong>{dupModal.score}%</strong>
              </p>
            )}

            <p>
              Existing file:{" "}
              <code style={{ wordBreak: "break-all" }}>{dupModal.existingPath}</code>
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 16,
              }}
            >
              <button
                onClick={() => sendDecision("skip")}
                style={{
                  padding: "8px 12px",
                  background: "#f44336",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Skip
              </button>

              <button
                onClick={() => sendDecision("rename")}
                style={{
                  padding: "8px 12px",
                  background: "#2196f3",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Save as new file
              </button>

              <button
                onClick={() => sendDecision("overwrite")}
                style={{
                  padding: "8px 12px",
                  background: "#ff9800",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
