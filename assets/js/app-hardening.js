/* Shared client hardening. Page-specific state stays with each feature. */
(function initAppHardening() {
  if (typeof window === "undefined" || window.__timzeeAppHardeningReady) return;
  window.__timzeeAppHardeningReady = true;

  const fileStates = new WeakMap();

  function fileKey(file) {
    return [file.name, file.size, file.lastModified, file.type].join("::");
  }

  function setInputFiles(input, files) {
    try {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      return true;
    } catch (error) {
      console.debug("Multi-file FileList synchronization unavailable:", error);
      return false;
    }
  }

  function setupAccumulatingInput(input, { maxFiles = Infinity, maxBytes = Infinity } = {}) {
    if (!input || fileStates.has(input)) return;
    const state = { files: [] };
    fileStates.set(input, state);

    input.addEventListener("change", () => {
      const incoming = Array.from(input.files || []);
      const seen = new Set(state.files.map(fileKey));

      for (const file of incoming) {
        if (file.size > maxBytes) continue;
        if (seen.has(fileKey(file))) continue;
        if (state.files.length >= maxFiles) break;
        state.files.push(file);
        seen.add(fileKey(file));
      }

      setInputFiles(input, state.files);
    }, true);

    input.addEventListener("resetmultifiles", () => {
      state.files = [];
      input.value = "";
    });
  }

  function removeTrackedFile(input, index) {
    const state = fileStates.get(input);
    if (!state || !Number.isInteger(index)) return;
    if (index < 0 || index >= state.files.length) return;
    state.files.splice(index, 1);
    setInputFiles(input, state.files);
  }

  function clearTrackedFileState(input) {
    const state = fileStates.get(input);
    if (!state) return;
    state.files = [];
    input.value = "";
  }

  function installMultiFileHardening() {
    const postMediaInput = document.getElementById("postMediaFiles");
    if (postMediaInput) setupAccumulatingInput(postMediaInput, { maxFiles: 8 });

    const docInput = document.getElementById("docInput");
    if (docInput) setupAccumulatingInput(docInput, { maxFiles: 20, maxBytes: 5 * 1024 * 1024 });

    document.addEventListener("click", (event) => {
      const removeNew = event.target.closest("[data-action=\"remove-new\"]");
      if (removeNew && postMediaInput) {
        removeTrackedFile(postMediaInput, Number(removeNew.dataset.index));
      }

      const removeDoc = event.target.closest(".remove-doc");
      if (removeDoc && docInput) {
        removeTrackedFile(docInput, Number(removeDoc.dataset.idx));
      }

      const clearPostMedia = event.target.closest("#clearPostMediaBtn");
      if (clearPostMedia && postMediaInput) {
        clearTrackedFileState(postMediaInput);
      }
    }, true);

    document.querySelectorAll("form").forEach((form) => {
      form.addEventListener("reset", () => {
        const postMediaInput = form.querySelector("#postMediaFiles");
        const docInput = form.querySelector("#docInput");
        if (postMediaInput) postMediaInput.dispatchEvent(new Event("resetmultifiles"));
        if (docInput) docInput.dispatchEvent(new Event("resetmultifiles"));
      }, true);
    });
  }

  function installVisualConsistency() {
    if (document.getElementById("app-hardening-style")) return;
    const style = document.createElement("style");
    style.id = "app-hardening-style";
    style.textContent = `
      .app-dialog-actions button { border-radius: 10px !important; }
      .site-menu-footer-actions .chip { border-radius: 999px; }
      #appHardeningNotice { line-height: 1.4; }
    `;
    document.head.appendChild(style);
  }

  function boot() {
    installMultiFileHardening();
    installVisualConsistency();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
