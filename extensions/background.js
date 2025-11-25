/* eslint-env webextensions */
/* global chrome */

chrome.downloads.onCreated.addListener((downloadItem) => {
  const url = downloadItem.finalUrl || downloadItem.url;
  if (!url) return;

  console.log("🌐 Intercepted download:", url);

  chrome.downloads.cancel(downloadItem.id, () => {
    console.log("⛔ Chrome download canceled — handing off to Electron");
  });

  sendToElectron(url);
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.url) return;
  console.log("⚡ Manual trigger:", tab.url);
  sendToElectron(tab.url);
});

function sendToElectron(url) {
  fetch("http://127.0.0.1:5050/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
    .then((res) => res.text().then((t) => {
      console.log("✅ Sent to Electron:", url, "Response:", t);
      notify("Download forwarded", "Sent to Download Manager");
    }))
    .catch((err) => {
      console.error("❌ Failed to send:", err);
      notify("Forward failed", "Could not reach Download Manager");
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
