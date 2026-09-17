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

  function ensureFeedbackRoot() {
    let root = document.getElementById("siteFeedbackRoot");
    if (root) return root;

    root = document.createElement("div");
    root.id = "siteFeedbackRoot";
    root.className = "site-feedback-root";
    root.setAttribute("aria-live", "polite");
    root.setAttribute("aria-atomic", "false");
    document.body.appendChild(root);
    return root;
  }

  function dismissToast(toast) {
    if (!toast || toast.dataset.closing === "true") return;
    toast.dataset.closing = "true";
    window.setTimeout(() => toast.remove(), 180);
  }

  function showSiteToast(message, { type = "info", title = "", duration = 4200 } = {}) {
    const text = String(message ?? "").trim();
    if (!text) return null;
    const root = ensureFeedbackRoot();
    const toast = document.createElement("div");
    toast.className = `site-toast site-toast-${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    const content = document.createElement("div");
    content.className = "site-toast-content";

    if (title) {
      const heading = document.createElement("strong");
      heading.className = "site-toast-title";
      heading.textContent = title;
      content.appendChild(heading);
    }

    const body = document.createElement("div");
    body.className = "site-toast-message";
    body.textContent = text;
    content.appendChild(body);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "site-toast-close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "×";
    close.addEventListener("click", () => dismissToast(toast));

    toast.appendChild(content);
    toast.appendChild(close);
    root.appendChild(toast);

    if (duration > 0) window.setTimeout(() => dismissToast(toast), duration);
    return toast;
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
    window.siteToast = showSiteToast;
    window.siteNotice = (message, type = "info", title = "") =>
      showSiteToast(message, { type, title });

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

    const originalAlert = window.alert;
    if (!window.__timzeeOriginalAlert) window.__timzeeOriginalAlert = originalAlert;
    window.alert = (message) => {
      showSiteToast(message, { type: "info", title: "Timzee Tech Hub" });
    };

    window.addEventListener("online", () => {
      showSiteToast("Connection restored. Your next action can continue normally.", {
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

  function installVisualConsistency() {
    if (document.getElementById("app-hardening-style")) return;
    const style = document.createElement("style");
    style.id = "app-hardening-style";
    style.textContent = `
      .app-dialog-actions button { border-radius: 10px !important; }
      .site-menu-footer-actions .chip { border-radius: 999px; }
      #appHardeningNotice { line-height: 1.4; }
      .site-feedback-root {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 2147483000;
        width: min(390px, calc(100vw - 36px));
        display: grid;
        gap: 10px;
        pointer-events: none;
      }
      .site-toast {
        pointer-events: auto;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 14px 14px 16px;
        border: 1px solid rgba(127, 127, 127, .25);
        border-radius: 14px;
        background: var(--card-solid, #fff);
        color: var(--ink, #171717);
        box-shadow: 0 16px 42px rgba(0, 0, 0, .16);
        transform: translateY(-6px);
        opacity: 0;
        animation: timzeeToastIn .18s ease forwards;
      }
      .site-toast-error { border-color: #ef4444; }
      .site-toast-success { border-color: #10b981; }
      .site-toast-warning { border-color: #f59e0b; }
      .site-toast-content { flex: 1; min-width: 0; }
      .site-toast-title { display: block; margin-bottom: 3px; }
      .site-toast-message { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; font-size: .94rem; }
      .site-toast-close {
        border: 0;
        background: transparent;
        color: inherit;
        font-size: 1.35rem;
        line-height: 1;
        padding: 2px 4px;
        cursor: pointer;
        opacity: .7;
      }
      .site-toast-close:hover, .site-toast-close:focus-visible { opacity: 1; }
      .site-connectivity-banner {
        position: fixed;
        left: 50%;
        top: 0;
        transform: translateX(-50%);
        z-index: 2147483001;
        width: min(720px, calc(100vw - 24px));
        padding: 10px 16px;
        border-radius: 0 0 12px 12px;
        background: #1f2937;
        color: #fff;
        text-align: center;
        box-shadow: 0 8px 24px rgba(0,0,0,.16);
        font-size: .92rem;
      }
      @keyframes timzeeToastIn { to { opacity: 1; transform: translateY(0); } }
      @media (max-width: 640px) {
        .site-feedback-root { top: 12px; right: 12px; width: calc(100vw - 24px); }
      }
    `;
    document.head.appendChild(style);
  }

  function boot() {
    installMultiFileHardening();
    installActionFeedback();
    installVisualConsistency();
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
