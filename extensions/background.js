/* eslint-env webextensions */
/* global chrome */

chrome.downloads.onCreated.addListener((downloadItem) => {
  const url = downloadItem.finalUrl || downloadItem.url;
  console.log("🌐 Intercepted download:", url);

  // Cancel Chrome's download so it doesn't duplicate the file in browser
  chrome.downloads.cancel(downloadItem.id, () => {
    console.log("⛔ Chrome download canceled, sending to Electron...");
  });

  // POST to Electron listener
  fetch("http://127.0.0.1:5050/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
    .then(() => {
      console.log("✅ Sent to Electron:", url);
      // show a notification to the user that it's forwarded
      if (chrome?.notifications) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon48.png", // include icon in extension
          title: "Download forwarded",
          message: "This download was sent to the Download Manager app.",
        });
      }
    })
    .catch((err) => {
      console.error("❌ Failed to send:", err);
      if (chrome?.notifications) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon48.png",
          title: "Forward failed",
          message: "Failed to send the download to the Download Manager.",
        });
      }
    });
});
