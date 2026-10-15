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
    if (docInput) {
      docInput.addEventListener("change", () => {
        window.setTimeout(() => {
          docInput.value = "";
        }, 0);
      }, true);
    }

    document.addEventListener("click", (event) => {
      const clearPostMedia = event.target.closest("#clearPostMediaBtn");
      if (clearPostMedia && postMediaInput) {
        clearTrackedFileState(postMediaInput);
      }
    }, true);

    document.querySelectorAll("form").forEach((form) => {
      form.addEventListener("reset", () => {
        const formPostMediaInput = form.querySelector("#postMediaFiles");
        if (formPostMediaInput) formPostMediaInput.dispatchEvent(new Event("resetmultifiles"));
      }, true);
    });
  }

  function safeSameOriginUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      if (url.origin !== window.location.origin) return "";
      if (url.protocol !== window.location.protocol && window.location.protocol !== "http:") return "";
      return url.pathname + url.search + url.hash;
    } catch {
      return "";
    }
  }

  function installActionFeedback() {

    window.goToActionResult = ({
      status = "success",
      title = "Action completed",
      message = "Your request has been processed.",
      next = "index.html",
      nextLabel = "Continue",
      retry = ""
    } = {}) => {
      const allowed = new Set(["success", "error", "warning", "info", "pending"]);
      const normalizedStatus = allowed.has(String(status).toLowerCase()) ? String(status).toLowerCase() : "info";
      const params = new URLSearchParams({
        status: normalizedStatus,
        title: String(title).slice(0, 140),
        message: String(message).slice(0, 2000),
        next: safeSameOriginUrl(next) || "index.html",
        nextLabel: String(nextLabel).slice(0, 40)
      });
      const retryUrl = safeSameOriginUrl(retry);
      if (retryUrl) params.set("retry", retryUrl);
      window.location.href = `action-result.html?${params.toString()}`;
    };

    window.addEventListener("online", () => {
      window.appUI.toast("Connection restored. Your next action can continue normally.", {
        type: "success",
        title: "Back online",
        duration: 3600
      });
      const banner = document.getElementById("siteConnectivityBanner");
      if (banner) banner.remove();
    });

    window.addEventListener("offline", () => {
      let banner = document.getElementById("siteConnectivityBanner");
      if (banner) return;
      banner = document.createElement("div");
      banner.id = "siteConnectivityBanner";
      banner.className = "site-connectivity-banner offline";
      banner.setAttribute("role", "status");
      banner.innerHTML = "<strong>You’re offline.</strong> Changes that need the server may not save until your connection returns.";
      document.body.appendChild(banner);
    });

    if (!navigator.onLine) window.setTimeout(() => window.dispatchEvent(new Event("offline")), 0);
  }

  function boot() {
    installMultiFileHardening();
    installActionFeedback();
    window.setTimeout(() => {
      import("./notification-popup.js")
        .then(({ initSiteNotifications }) => initSiteNotifications())
        .catch((error) => console.warn("Realtime site notifications unavailable:", error));
    }, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
