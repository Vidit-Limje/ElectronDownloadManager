import React, { useEffect, useState } from "react";

export default function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);

  // Modal data from duplicate-detected event
  const [dupModal, setDupModal] = useState(null);
  // dupModal = { dupId, name, partialHash, existingPath, matchType, distance }

  useEffect(() => {
    // progress/done/error listeners
    window.dm?.onProgress((p) => {
      setProgress(Number(p.percent));
      setStatus(`Downloading ${p.name} — ${p.percent}%`);
    });

    window.dm?.onDone((d) => {
      setStatus(`✅ Download complete: ${d.name || d.filePath}`);
      setProgress(0);
    });

    window.dm?.onError(() => {
      setStatus(`❌ Download error`);
      setProgress(0);
    });

    // Duplicate or fuzzy match detected
    window.dm?.onDuplicate((data) => {
      setDupModal(data);
    });
  }, []);

  function startDownload() {
    if (!url.trim()) return alert("Enter URL");
    setStatus("Starting download...");
    window.dm?.download(url);
  }

  function onDecision(shouldContinue) {
    if (!dupModal) return;
    window.dm?.sendDecision(dupModal.dupId, { continue: !!shouldContinue });
    setDupModal(null);
    setStatus(shouldContinue ? "Resuming download..." : "Download cancelled");
  }

  // Convert TLSH distance → similarity %
  function computeSimilarity(distance) {
    if (distance == null) return null;
    const maxDist = 200; // conservative scaling
    const sim = Math.max(0, 100 - (distance / maxDist) * 100);
    return sim.toFixed(1);
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
            <div>{progress}%</div>
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
            background: "rgba(0,0,0,0.4)",
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
              width: 540,
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
                : "an identical file"}{" "}
              was found on your system.
            </p>

            {dupModal.matchType === "fuzzy" && dupModal.distance != null && (
              <p>
                Similarity confidence:{" "}
                <strong>{computeSimilarity(dupModal.distance)}%</strong>{" "}
                (TLSH distance = {dupModal.distance})
              </p>
            )}

            <p>
              Partial SHA-256 (first 1MB):{" "}
              <code style={{ wordBreak: "break-all" }}>
                {dupModal.partialHash}
              </code>
            </p>
            <p>Existing file: {dupModal.existingPath}</p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 16,
              }}
            >
              <button
                onClick={() => onDecision(false)}
                style={{
                  padding: "8px 12px",
                  background: "#f44336",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Cancel download
              </button>
              <button
                onClick={() => onDecision(true)}
                style={{
                  padding: "8px 12px",
                  background: "#2196f3",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
