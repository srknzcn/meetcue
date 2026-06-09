(() => {
  ////////////////////////////////////////////////////////////////////////////
  // Auto-enable live captions when the popup opens on an active Meet tab
  ////////////////////////////////////////////////////////////////////////////
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (tab && /^https:\/\/meet\.google\.com\//.test(tab.url || "")) {
      chrome.tabs.sendMessage(tab.id, { type: "enableCaptions" }, () => {
        // Swallow "no receiving end" if the content script isn't ready yet.
        void chrome.runtime.lastError;
      });
    }
  });

  ////////////////////////////////////////////////////////////////////////////
  // Constants
  ////////////////////////////////////////////////////////////////////////////

  const VALID_STATUSES = ["success", "info", "warning", "danger"];

  // Status DOM elements
  const footerDiv = document.querySelector("footer.footer");
  const footerMsg = document.getElementById("alert-msg");

  // Reflect a status log onto the footer (dot color + message) via data-status.
  const applyStatus = (log) => {
    if (!log) return;
    const status = VALID_STATUSES.includes(log.status) ? log.status : "info";
    footerDiv.setAttribute("data-status", status);
    if (log.message) footerMsg.innerText = log.message;
  };

  // Show pre-existing status
  chrome.storage.sync.get(["details"], (data) => {
    if (data.details) applyStatus(data.details.options);
  });

  // Listen upcoming status from content.js
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.details && changes.details.newValue.type === "log") {
      applyStatus(changes.details.newValue.options);
    }

    // ref: https://stackoverflow.com/a/20077854/11674552
    return true;
  });

  // This Adds Words to The DOM (called from addBtn listener)
  const addWords = (wordsArray) => {
    const displayedWords = [
      ...document.querySelectorAll(".word__ele"),
    ].map((i) => i.innerText.toLowerCase());

    for (let j = 0; j < wordsArray.length; j++) {
      // Checks if not already exists
      if (!displayedWords.includes(wordsArray[j].toLowerCase())) {
        const wordBox = document.createElement("div");
        wordBox.setAttribute("class", "words__box");

        const pTag = document.createElement("p");
        pTag.setAttribute("class", "word__ele");
        pTag.innerText = wordsArray[j];

        const removeBtn = document.createElement("button");
        removeBtn.setAttribute("class", "words__box-remove");
        removeBtn.setAttribute("type", "button");
        removeBtn.setAttribute("aria-label", `Remove ${wordsArray[j]}`);
        removeBtn.innerText = "×";

        removeBtn.addEventListener("click", (e) => {
          const val = pTag.innerText.toLowerCase();
          e.currentTarget.parentElement.remove();

          chrome.storage.sync.get(["alertWords"], (data) => {
            const alertWords = data.alertWords;
            const idx = alertWords.map((i) => i.toLowerCase()).indexOf(val);

            if (idx > -1) {
              alertWords.splice(idx, 1);
            }

            chrome.storage.sync.set({ alertWords });
          });
        });

        wordBox.append(pTag, removeBtn);

        const parentBox = document.querySelector(".words__boxes");
        parentBox.appendChild(wordBox);
      }
    }
  };

  // Get pre-existing alert words
  chrome.storage.sync.get(["alertWords"], (data) => {
    const alertWords = data.alertWords;

    // Add to DOM
    if (alertWords) addWords(alertWords);
  });

  const addBtn = document.getElementById("add-btn");

  // Add Button Event Listener
  addBtn.addEventListener("click", () => {
    const alertWordsDoc = document.getElementById("alert-words");
    const alertWords = alertWordsDoc.value.split(",").map((str) => str.trim());

    if (!alertWords.includes("")) {
      // Add them to DOM
      addWords(alertWords);

      // Remove from input box
      alertWordsDoc.value = "";

      const displayedWords = [...document.querySelectorAll(".word__ele")].map(
        (i) => i.innerText
      );

      // Save to local storage
      saveToLocalStorage(displayedWords);
    }
  });

  // Saves to sync storage, called from addBtn event listener
  const saveToLocalStorage = (displayedWords) => {
    chrome.storage.sync.set({ alertWords: displayedWords });
  };

  document.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
  });

  ////////////////////////////////////////////////////////////////////////////
  // ntfy forwarding settings (forward alerts to phone / Apple Watch)
  ////////////////////////////////////////////////////////////////////////////
  const ntfyEnabled = document.getElementById("ntfy-enabled");
  const ntfyServer = document.getElementById("ntfy-server");
  const ntfyTopic = document.getElementById("ntfy-topic");
  const ntfySaveBtn = document.getElementById("ntfy-save");
  const ntfyTestBtn = document.getElementById("ntfy-test");
  const ntfyStatus = document.getElementById("ntfy-status");

  const setNtfyStatus = (message, state) => {
    ntfyStatus.innerText = message || "";
    if (state) ntfyStatus.setAttribute("data-state", state);
    else ntfyStatus.removeAttribute("data-state");
  };

  // Normalize a server field into a clean origin URL: prepend https:// when no
  // scheme is given, and drop trailing slashes so `${server}/${topic}` is clean.
  const normalizeServer = (raw) => {
    let s = (raw || "").trim().replace(/\/+$/, "");
    if (s && !/^https?:\/\//i.test(s)) s = "https://" + s;
    return s;
  };

  // Derive the `<origin>/*` match pattern needed to request host permission.
  const originPattern = (server) => {
    try {
      return new URL(server).origin + "/*";
    } catch {
      return null;
    }
  };

  // Ask for host permission for this server's origin (must run in a user
  // gesture — both callers are click handlers). Granted origins apply to every
  // extension context, so the background service worker can fetch too.
  const ensurePermission = async (server) => {
    const pattern = originPattern(server);
    if (!pattern) return false;
    return chrome.permissions.request({ origins: [pattern] });
  };

  // Load saved settings into the form.
  chrome.storage.sync.get(["ntfy"], ({ ntfy }) => {
    if (!ntfy) return;
    ntfyEnabled.checked = !!ntfy.enabled;
    ntfyServer.value = ntfy.server || "";
    ntfyTopic.value = ntfy.topic || "";
  });

  ntfySaveBtn.addEventListener("click", async () => {
    const enabled = ntfyEnabled.checked;
    const server = normalizeServer(ntfyServer.value);
    const topic = ntfyTopic.value.trim();
    ntfyServer.value = server; // reflect normalization back to the field

    if (enabled && (!server || !topic)) {
      setNtfyStatus("Sunucu ve topic gerekli", "err");
      return;
    }
    if (enabled && server && !originPattern(server)) {
      setNtfyStatus("Geçersiz sunucu adresi", "err");
      return;
    }
    if (enabled && server && !(await ensurePermission(server))) {
      setNtfyStatus("Sunucuya erişim izni verilmedi", "err");
      return;
    }

    chrome.storage.sync.set({ ntfy: { enabled, server, topic } }, () => {
      setNtfyStatus("Kaydedildi", "ok");
    });
  });

  ntfyTestBtn.addEventListener("click", async () => {
    const server = normalizeServer(ntfyServer.value);
    const topic = ntfyTopic.value.trim();
    ntfyServer.value = server;

    if (!server || !topic) {
      setNtfyStatus("Önce sunucu ve topic gir", "err");
      return;
    }
    if (!originPattern(server) || !(await ensurePermission(server))) {
      setNtfyStatus("Sunucuya erişim izni verilmedi", "err");
      return;
    }

    setNtfyStatus("Gönderiliyor…");
    try {
      const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
        method: "POST",
        headers: { Title: "MeetCue", Tags: "bell" },
        body: "Test bildirimi — MeetCue çalışıyor.",
      });
      setNtfyStatus(
        res.ok ? "Test gönderildi ✓" : `Sunucu hatası: ${res.status}`,
        res.ok ? "ok" : "err"
      );
    } catch (e) {
      setNtfyStatus("Gönderilemedi: " + e.message, "err");
    }
  });
})();
