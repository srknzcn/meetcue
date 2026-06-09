// Service worker (Manifest V3).
// Receives match events from content.js, builds the notification.
// The avatar is fetched here (not in the content script) because MV3 content
// scripts are bound by the page's CSP/CORS, whereas the service worker can
// fetch cross-origin given host_permissions in manifest.json.

const FALLBACK_ICON = "images/bell128.png";

// Convert a remote image URL to a data URL.
// Service workers have no FileReader, so we base64-encode the bytes manually.
const toDataURL = async (url) => {
  const response = await fetch(url);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const mime = blob.type || "image/png";
  return `data:${mime};base64,${btoa(binary)}`;
};

chrome.runtime.onMessage.addListener((data) => {
  if (data.type !== "notification") return;

  const { speaker, speech, photo } = data;
  const baseOptions = {
    type: "basic",
    title: "Alert — from Google Meet",
    message: `${speaker} just said ${speech}`,
  };

  const create = (iconUrl) =>
    chrome.notifications.create("", { ...baseOptions, iconUrl });

  // Mirror the alert to ntfy (phone / Apple Watch) when configured. content.js
  // only sends this message while the Meet tab is unfocused, so the "alert only
  // when you're elsewhere" rule carries over for free. Failures are swallowed —
  // a down ntfy server must never break the desktop notification.
  chrome.storage.sync.get(["ntfy"], ({ ntfy }) => {
    if (!ntfy || !ntfy.enabled || !ntfy.server || !ntfy.topic) return;
    fetch(`${ntfy.server}/${encodeURIComponent(ntfy.topic)}`, {
      method: "POST",
      headers: { Title: "MeetCue", Tags: "bell" },
      body: `${speaker}: ${speech}`,
    }).catch(() => {});
  });

  // Try the speaker's avatar; fall back to the extension icon on any failure.
  if (photo) {
    toDataURL(photo)
      .then((iconUrl) => create(iconUrl))
      .catch(() => create(FALLBACK_ICON));
  } else {
    create(FALLBACK_ICON);
  }
});
