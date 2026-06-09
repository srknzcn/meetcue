# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MeetCue is a Manifest V3 Chrome extension that watches Google Meet's live captions and fires a desktop notification when one of the user's keywords is spoken. No build step, no dependencies, no backend, no tests — plain JS/HTML/CSS loaded directly by Chrome.

## Develop / test / release

- **Run it:** `chrome://extensions` → enable Developer mode → **Load unpacked** → pick the repo root. After editing, click the reload ↻ on the extension card. Content-script changes also require reloading the open `meet.google.com` tab.
- **Debug:** content script logs to the Meet page console (prefix `[MeetCue]`); the service worker has its own console via the extension card's "service worker" link; the popup has its own DevTools (right-click the popup → Inspect).
- **No tests / no lint / no build** — verification is manual in a real Meet call with captions on.
- **Release:** bump `version` in `manifest.json`, then produce the distributable zip named to match: `meetcue-<version>.zip` (the committed zip is the release artifact, e.g. `meetcue-0.3.0.zip`).

## Architecture

Three isolated contexts that never call each other directly — they communicate only through `chrome.storage.sync` and `chrome.runtime` messaging:

- **`content.js`** — injected into `meet.google.com`. Watches captions and decides when to alert.
- **`background.js`** — MV3 service worker. Builds the actual notification.
- **`src/popup.{html,js,css}`** — toolbar popup. Manages the keyword list and shows status.

### Data flow

1. Popup writes `alertWords` (array) to `chrome.storage.sync`. Content script reads it on load and via `storage.onChanged`.
2. Content script `MutationObserver`s the caption region, matches caption text against `alertWords`, and on a hit sends a `{type:"notification", speaker, speech, photo}` runtime message.
3. Background receives it and calls `chrome.notifications.create`.
4. Status messages flow the other way: content script writes `details = {type:"log", options:{status, message}}` to `storage.sync`; the popup footer reflects it (dot color via `data-status`, text via `#alert-msg`).
5. Popup-open → content script: popup sends `{type:"enableCaptions"}` so captions auto-toggle on.

### Why notifications are built in the service worker, not the content script

MV3 content scripts are bound by the page's CSP/CORS and cannot fetch the cross-origin speaker avatar. The service worker can (given `host_permissions`), so it fetches the avatar, base64-encodes the bytes manually (service workers have no `FileReader`), and falls back to `images/bell128.png` on any failure.

## Critical, non-obvious constraints

- **Google rotates Meet's obfuscated class names.** The code deliberately keys off *structure* and locale-independent signals, not brittle class names: the caption line's child containing the `<img>` avatar is the speaker block (its text is the name, the rest is speech); the captions toggle button is found by its Material icon name `closed_caption` rather than a class or localized label. Only `.a4cQT` (caption region) and `.nMcdL` (caption line) are relied on as classes because they've been stable. Preserve this structure-first approach when touching selectors — see the `SEL` map and comments in `content.js`.
- **Alerts only fire when the Meet tab is NOT focused/visible** (`document.visibilityState === "visible" && document.hasFocus()` → skip). The whole point is to notify when the user is looking elsewhere. Don't "fix" this.
- **Self-speech is skipped** via `SELF_LABELS` (localized "you"/"siz"/"sen"). Add locales here, not elsewhere.
- **Dedupe + throttle:** a `Set` keyed on `${speaker}::${speech}` plus a 3s global `THROTTLE_MS` keeps one utterance from firing repeatedly as captions re-render. The set is bounded (cleared past 50 entries).
- **Captions must be on** in the meeting or there's nothing to match — the extension does no speech processing of its own.
- The chime is synthesized via Web Audio in the page context (no audio asset), which dodges autoplay blocking since the Meet tab is already audio-enabled.
- The extension is multi-locale aware (caption button labels, self-labels). Keep new user-facing matching logic locale-tolerant.
