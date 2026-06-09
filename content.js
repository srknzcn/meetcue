console.log("[alert-me-google-meet] loaded");

try {
  (() => {
    // -------------------------------------------------------------------------
    // Selectors (Google Meet — verified 2026-06)
    // Google obfuscates and rotates these class names. `.a4cQT` (captions
    // region) and `.nMcdL` (a single caption line) have stayed stable for a
    // long time; the others have fallbacks so a single rename can't kill it.
    // -------------------------------------------------------------------------
    const SEL = {
      captionRegion: ".a4cQT",
      captionLine: ".nMcdL",
      speechText: ".ygicle", // speech bubble (fallback only)
      avatar: "img",
    };

    const setStatus = (status, message) =>
      chrome.storage.sync.set({
        details: { type: "log", options: { status, message } },
      });

    setStatus("danger", "Not on call");

    // -------------------------------------------------------------------------
    // Alert words (kept in sync with the popup)
    // -------------------------------------------------------------------------
    let ALERT_WORDS = [];
    chrome.storage.sync.get(["alertWords"], (data) => {
      if (data.alertWords)
        ALERT_WORDS = data.alertWords.map((s) => s.toLowerCase());
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.alertWords && changes.alertWords.newValue)
        ALERT_WORDS = changes.alertWords.newValue.map((s) => s.toLowerCase());
    });

    // -------------------------------------------------------------------------
    // Extract speaker / speech / avatar from one caption line
    // -------------------------------------------------------------------------
    // A caption line holds a speaker block (avatar + name) and the speech text
    // as siblings. Rather than depend on Google's rotating class names, we key
    // off structure: the line child that contains the avatar <img> is the
    // speaker block; its text is the name, and the rest of the line is speech.
    const getAvatar = (line) => line.querySelector(SEL.avatar)?.src || null;

    const getSpeakerBlock = (line) => {
      const img = line.querySelector(SEL.avatar);
      if (!img) return null;
      let n = img;
      while (n.parentElement && n.parentElement !== line) n = n.parentElement;
      return n.parentElement === line ? n : null;
    };

    const getName = (line) => {
      const block = getSpeakerBlock(line);
      return (block?.textContent || "").trim() || "Someone";
    };

    const getSpeech = (line) => {
      const block = getSpeakerBlock(line);
      if (block) {
        const full = line.textContent;
        const name = block.textContent;
        return (
          full.startsWith(name) ? full.slice(name.length) : full.replace(name, "")
        ).trim();
      }
      // Fallback when there's no avatar block.
      return (line.querySelector(SEL.speechText)?.textContent || line.textContent).trim();
    };

    // Meet labels your own captions with "You" (localized). Don't alert on
    // your own speech — you already know what you said.
    const SELF_LABELS = new Set(["you", "siz", "sen"]);

    // -------------------------------------------------------------------------
    // Notification sound — a short two-tone chime via Web Audio (no asset
    // needed). Played from the page context, which is already audio-enabled
    // during a Meet call, so it isn't blocked by autoplay policy.
    // -------------------------------------------------------------------------
    let audioCtx = null;
    const playChime = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = audioCtx || new Ctx();
        if (audioCtx.state === "suspended") audioCtx.resume();
        const t0 = audioCtx.currentTime;
        [
          [880, 0], // A5
          [1174.7, 0.13], // D6
        ].forEach(([freq, offset]) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          const start = t0 + offset;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(start);
          osc.stop(start + 0.24);
        });
      } catch (e) {
        console.warn("[alert-me-google-meet] sound failed", e);
      }
    };

    // -------------------------------------------------------------------------
    // Throttle + dedupe so a single utterance fires at most one notification
    // -------------------------------------------------------------------------
    let lastAlertAt = 0;
    const THROTTLE_MS = 3000;
    const alerted = new Set(); // `${speaker}::${speech}` already notified

    const scan = (region) => {
      const now = Date.now();
      region.querySelectorAll(SEL.captionLine).forEach((line) => {
        const speech = getSpeech(line);
        if (!speech) return;

        const lwr = speech.toLowerCase();
        const word = ALERT_WORDS.find((w) => w && lwr.indexOf(w) !== -1);
        if (!word) return;

        // Don't notify while the user is actively looking at the meeting:
        // the Meet tab is the focused, visible tab. The point of the extension
        // is to alert when you're elsewhere.
        if (document.visibilityState === "visible" && document.hasFocus()) return;

        const speaker = getName(line);

        // Skip your own speech ("You" / localized self label).
        if (SELF_LABELS.has(speaker.toLowerCase())) return;

        const key = `${speaker}::${speech}`;
        if (alerted.has(key)) return; // same snapshot already alerted
        if (now - lastAlertAt < THROTTLE_MS) return; // global throttle

        lastAlertAt = now;
        alerted.add(key);
        if (alerted.size > 50) alerted.clear(); // keep the set bounded

        setStatus("info", "You were notified. Check your notifications");
        playChime();

        // The service worker fetches the avatar + builds the notification
        // (MV3 content scripts can't fetch cross-origin avatars).
        chrome.runtime.sendMessage({
          type: "notification",
          speaker,
          speech,
          photo: getAvatar(line),
        });
      });
    };

    // -------------------------------------------------------------------------
    // Auto-enable Meet's live captions (triggered from the popup)
    // The caption button is icon-based with localized labels, so we match on
    // several locales + the material icon name rather than a brittle class.
    // -------------------------------------------------------------------------
    const findCaptionButton = () => {
      const cands = [...document.querySelectorAll('button, [role="button"]')];
      // Primary signal: the Material icon name is locale-independent. The
      // captions TOGGLE uses "closed_caption[_off]"; the settings gear uses
      // "settings" and the jump button uses "arrow_downward", so this uniquely
      // identifies the toggle regardless of UI language.
      for (const b of cands) {
        const icon = b.querySelector("i");
        if (icon && /closed_caption/i.test(icon.textContent || "")) return b;
      }
      // Fallback: aria-label for the toggle, excluding the settings/jump buttons.
      const rx =
        /caption|subtitle|altyaz|untertitel|sous-titre|subt[ií]tulo|sottotitoli|legenda|字幕|자막/i;
      const exclude = /setting|ayar|param|réglage|ajuste|impostazi|recent|jump|atla/i;
      for (const b of cands) {
        const label =
          (b.getAttribute("aria-label") || "") +
          " " +
          (b.getAttribute("data-tooltip") || "");
        if (rx.test(label) && !exclude.test(label)) return b;
      }
      return null;
    };

    const enableCaptions = () => {
      // Already on (caption region present) → nothing to do.
      if (document.querySelector(SEL.captionRegion)) return "already-on";
      const btn = findCaptionButton();
      if (!btn) return "no-button"; // not in an active call, or controls not ready
      btn.click();
      return "clicked";
    };

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === "enableCaptions") {
        sendResponse({ result: enableCaptions() });
      }
      return true;
    });

    // -------------------------------------------------------------------------
    // Watch the captions region; (dis)connect as captions are toggled
    // -------------------------------------------------------------------------
    let regionObserver = null;

    const startWatching = (region) => {
      setStatus("success", "You're all set, add your keywords and relax");
      regionObserver = new MutationObserver(() => scan(region));
      regionObserver.observe(region, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      scan(region); // catch text already on screen
    };

    const docObserver = new MutationObserver(() => {
      const region = document.querySelector(SEL.captionRegion);
      if (region && !regionObserver) {
        startWatching(region);
      } else if (!region && regionObserver) {
        regionObserver.disconnect();
        regionObserver = null;
        setStatus("warning", "Turn on your captions");
      }
    });
    docObserver.observe(document.body, { childList: true, subtree: true });

    // Captions might already be on when the script loads.
    const existing = document.querySelector(SEL.captionRegion);
    if (existing) startWatching(existing);
  })();
} catch (e) {
  console.error("[alert-me-google-meet] init error", e);
}
