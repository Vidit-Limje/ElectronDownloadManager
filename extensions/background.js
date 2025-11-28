/* eslint-env webextensions */
/* global chrome */

const lastUrls = new Set();

// Extensions + HTML pages we never forward
const BLOCKED_EXT = [
  ".htm", ".html",
  ".php", ".asp", ".aspx",
  ".js", ".css",
  ".svg", ".ico",
  ".json",
];

// Ignore tiny files (Chrome retry or prefetch)
const MIN_VALID_SIZE = 1024; // 1 KB

chrome.downloads.onCreated.addListener((downloadItem) => {
  const url = downloadItem.finalUrl || downloadItem.url;
  if (!url) return;

  const filename = downloadItem.filename || url.split("/").pop();

  // 1️⃣ IGNORE Chrome internal / auto / retry downloads
  if (
    downloadItem.fileSize === 0 ||
    downloadItem.totalBytes === 0 ||
    downloadItem.state === "interrupted" ||
    lastUrls.has(url)
  ) {
    console.log("⏩ Ignoring auto/retry download:", url);
    chrome.downloads.cancel(downloadItem.id);
    return;
  }

  // 2️⃣ Block HTML / temp / redirect pages
  if (BLOCKED_EXT.some(ext => filename.toLowerCase().endsWith(ext))) {
    console.log("⏩ Ignoring webpage download:", filename);
    chrome.downloads.cancel(downloadItem.id);
    return;
  }

  // 3️⃣ Skip extremely small files (Chrome noise)
  if (downloadItem.fileSize > 0 && downloadItem.fileSize < MIN_VALID_SIZE) {
    console.log("⏩ Ignoring tiny download:", filename, downloadItem.fileSize);
    chrome.downloads.cancel(downloadItem.id);
    return;
  }

  // 4️⃣ Prevent forwarding the same URL again
  lastUrls.add(url);

  console.log("🌐 Intercepted valid download:", url);

  chrome.downloads.cancel(downloadItem.id);

  sendToElectron(url);
});

// Toolbar button → manual send
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.url) return;
  console.log("⚡ Manual trigger:", tab.url);
  sendToElectron(tab.url);
});

// Send download URL to Electron server
function sendToElectron(url) {
  fetch("http://127.0.0.1:5050/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
    .then((res) =>
      res.text().then((t) => {
        console.log("✅ Sent to Electron:", url);
        notify("Download forwarded", "Sent to Download Manager");
      })
    )
    .catch((err) => {
      console.error("❌ Failed to send:", err);
      notify("Forward failed", "Could not reach Electron app");
    });
}

function notify(title, message) {
  chrome.notifications?.create({
    type: "basic",
    iconUrl: "icon48.png",
    title,
    message,
  });
}
