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
})();
