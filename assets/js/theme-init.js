(function () {
  const STORAGE_KEY = "timzee-theme";
  const DARK = "dark";
  const LIGHT = "light";
  const NETLIFY_FUNCTION_PREFIX = "/.netlify/functions/";
  const FUNCTION_ERROR_THROTTLE_MS = 20000;
  const TOAST_LIFETIME_MS = 5200;

  const lastFunctionErrors = new Map();

  const extractErrorMessage = (error, fallback = "Unexpected error.") => {
    if (!error) return fallback;
    if (typeof error === "string") return error;
    if (typeof error.message === "string" && error.message.trim()) return error.message;
    if (typeof error.error_description === "string" && error.error_description.trim()) {
      return error.error_description;
    }
    if (typeof error.details === "string" && error.details.trim()) return error.details;
    if (typeof error.error === "string" && error.error.trim()) return error.error;
    if (error.error && typeof error.error === "object") {
      return extractErrorMessage(error.error, fallback);
    }
    return fallback;
  };

  const ensureUiStyles = () => {
    if (typeof document === "undefined") return;
    if (document.getElementById("appUiStyles")) return;
    const style = document.createElement("style");
    style.id = "appUiStyles";
    style.textContent = `
      .app-toast-root {
        position: fixed;
        right: 12px;
        bottom: calc(12px + env(safe-area-inset-bottom));
        z-index: 15000;
        display: grid;
        gap: 10px;
        width: min(420px, calc(100vw - 24px));
      }
      .app-toast {
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.25);
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95));
        color: #f8fafc;
        box-shadow: 0 16px 28px rgba(2, 6, 23, 0.42);
        padding: 12px 14px;
        display: grid;
        gap: 4px;
        animation: appToastIn 180ms ease;
      }
      .app-toast strong {
        font-size: 13px;
      }
      .app-toast span {
        font-size: 13px;
        line-height: 1.45;
      }
      .app-toast.info { border-left: 4px solid #38bdf8; }
      .app-toast.success { border-left: 4px solid #22c55e; }
      .app-toast.error { border-left: 4px solid #ef4444; }
      .app-toast.warning { border-left: 4px solid #f59e0b; }
      .app-dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 16000;
        background: rgba(2, 6, 23, 0.58);
        display: grid;
        place-items: center;
        padding: 14px;
      }
      .app-dialog {
        width: min(520px, 100%);
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: var(--card-solid, #ffffff);
        color: var(--ink, #131417);
        box-shadow: 0 24px 38px rgba(15, 23, 42, 0.3);
        padding: 18px;
        display: grid;
        gap: 12px;
      }
      .app-dialog h3 {
        margin: 0;
        font-size: 18px;
      }
      .app-dialog p {
        margin: 0;
        line-height: 1.6;
        color: var(--muted, #5b6573);
        white-space: pre-wrap;
      }
      .app-dialog input,
      .app-dialog textarea {
        width: 100%;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 14px;
        font-family: inherit;
        background: var(--card, rgba(255,255,255,0.92));
        color: inherit;
      }
      .app-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
      }
      .app-dialog-actions button {
        border-radius: 999px;
        min-height: 38px;
        padding: 8px 14px;
        border: 1px solid rgba(148, 163, 184, 0.4);
        cursor: pointer;
        font-weight: 600;
      }
      .app-dialog-actions .primary {
        background: linear-gradient(135deg, #0f766e, #14b8a6);
        border-color: #0f766e;
        color: #ffffff;
      }
      .app-dialog-actions .ghost {
        background: transparent;
        color: inherit;
      }
      @keyframes appToastIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (max-width: 640px) {
        .app-toast-root { right: 8px; bottom: calc(8px + env(safe-area-inset-bottom)); width: calc(100vw - 16px); }
        .app-dialog { padding: 14px; }
      }
    `;
    document.head.appendChild(style);
  };

  const getToastRoot = () => {
    if (typeof document === "undefined") return null;
    ensureUiStyles();
    let root = document.getElementById("appToastRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = "appToastRoot";
      root.className = "app-toast-root";
      (document.body || document.documentElement).appendChild(root);
    }
    return root;
  };

  const showAppToast = (message, options = {}) => {
    if (typeof document === "undefined") return;
    const root = getToastRoot();
    if (!root) return;

    const tone = options.tone || "info";
    const title = options.title || (tone === "error" ? "Error" : "Notice");
    const life = Number.isFinite(options.duration) ? options.duration : TOAST_LIFETIME_MS;

    const card = document.createElement("div");
    card.className = `app-toast ${tone}`;
    card.innerHTML = `<strong>${title}</strong><span>${String(message || "")}</span>`;
    root.appendChild(card);

    const close = () => {
      card.style.opacity = "0";
      card.style.transition = "opacity 180ms ease";
      setTimeout(() => card.remove(), 200);
    };

    setTimeout(close, life);
    card.addEventListener("click", close);
  };

  const openAppDialog = async ({
    title = "Notice",
    message = "",
    mode = "alert",
    placeholder = "",
    defaultValue = "",
    confirmText = "OK",
    cancelText = "Cancel"
  } = {}) => {
    if (typeof document === "undefined") {
      if (mode === "confirm") return true;
      if (mode === "prompt") return defaultValue || "";
      return undefined;
    }
    ensureUiStyles();

    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "app-dialog-backdrop";
      const dialog = document.createElement("div");
      dialog.className = "app-dialog";

      const titleEl = document.createElement("h3");
      titleEl.textContent = String(title);
      const messageEl = document.createElement("p");
      messageEl.textContent = String(message);

      dialog.appendChild(titleEl);
      dialog.appendChild(messageEl);

      let input = null;
      if (mode === "prompt") {
        input = document.createElement("textarea");
        input.placeholder = placeholder || "Type here...";
        input.value = defaultValue || "";
        input.rows = 4;
        dialog.appendChild(input);
      }

      const actions = document.createElement("div");
      actions.className = "app-dialog-actions";

      const finish = (value) => {
        backdrop.remove();
        resolve(value);
      };

      if (mode !== "alert") {
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "ghost";
        cancelBtn.textContent = cancelText;
        cancelBtn.addEventListener("click", () => finish(mode === "confirm" ? false : null));
        actions.appendChild(cancelBtn);
      }

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "primary";
      confirmBtn.textContent = confirmText;
      confirmBtn.addEventListener("click", () => {
        if (mode === "confirm") {
          finish(true);
          return;
        }
        if (mode === "prompt") {
          finish(input ? input.value : "");
          return;
        }
        finish(undefined);
      });
      actions.appendChild(confirmBtn);

      dialog.appendChild(actions);
      backdrop.appendChild(dialog);
      (document.body || document.documentElement).appendChild(backdrop);

      backdrop.addEventListener("click", (event) => {
        if (event.target !== backdrop) return;
        finish(mode === "confirm" ? false : mode === "prompt" ? null : undefined);
      });

      if (input) input.focus();
      else confirmBtn.focus();
    });
  };

  const setupAppUiApi = () => {
    if (typeof window === "undefined") return;
    if (!window.appUI) window.appUI = {};
    window.appUI.toast = (message, opts = {}) => showAppToast(message, opts);
    window.appUI.alert = (message, opts = {}) => openAppDialog({ mode: "alert", message, ...opts });
    window.appUI.confirm = (message, opts = {}) => openAppDialog({ mode: "confirm", message, ...opts });
    window.appUI.prompt = (message, opts = {}) => openAppDialog({ mode: "prompt", message, ...opts });
  };

  const showRuntimeBanner = (context, message) => {
    const text = `${context}: ${message}`;
    showAppToast(text, { tone: "error", title: context, duration: 7000 });
    if (window.console && typeof window.console.error === "function") {
      window.console.error(`[${context}] ${message}`);
    }
  };

  const shouldNotifyFunctionError = (functionName, message) => {
    const key = `${functionName}:${message}`;
    const now = Date.now();
    const prev = lastFunctionErrors.get(key) || 0;
    if (now - prev < FUNCTION_ERROR_THROTTLE_MS) return false;
    lastFunctionErrors.set(key, now);
    return true;
  };

  const setupGlobalErrorHandlers = () => {
    if (typeof window === "undefined" || window.__timzeeErrorHandlersReady) return;
    window.__timzeeErrorHandlersReady = true;
    window.addEventListener("error", (event) => {
      const message = extractErrorMessage(event?.error || event?.message, "Unexpected website error.");
      showRuntimeBanner("Website error", message);
    });
    window.addEventListener("unhandledrejection", (event) => {
      const message = extractErrorMessage(event?.reason, "Unhandled backend error.");
      showRuntimeBanner("Backend error", message);
    });
  };

  const getRequestUrl = (input) => {
    try {
      if (typeof input === "string") return new URL(input, window.location.origin);
      if (input && typeof input.url === "string") return new URL(input.url, window.location.origin);
      return null;
    } catch (error) {
      return null;
    }
  };

  const getFunctionName = (url) => {
    if (!url || !url.pathname) return "unknown-function";
    const idx = url.pathname.indexOf(NETLIFY_FUNCTION_PREFIX);
    if (idx < 0) return "unknown-function";
    const tail = url.pathname.slice(idx + NETLIFY_FUNCTION_PREFIX.length);
    return tail.split("/")[0] || "unknown-function";
  };

  const extractFunctionErrorDetails = async (response) => {
    const contentType = response.headers.get("content-type") || "";
    let raw = "";
    try {
      raw = await response.clone().text();
    } catch (error) {
      raw = "";
    }
    const trimmed = raw.trim();
    if (contentType.includes("application/json") && trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        return extractErrorMessage(parsed, `Function returned HTTP ${response.status}.`);
      } catch (error) {
        // Fall through to text checks.
      }
    }
    if (contentType.includes("text/html") || trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")) {
      return "Function route returned HTML instead of JSON. This usually means Netlify Functions are not running.";
    }
    if (trimmed) return trimmed.slice(0, 240);
    return `Function returned HTTP ${response.status}.`;
  };

  const setupFunctionErrorMonitoring = () => {
    if (typeof window === "undefined" || typeof window.fetch !== "function" || window.__timzeeFetchMonitorReady) return;
    window.__timzeeFetchMonitorReady = true;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const url = getRequestUrl(input);
      const isFunctionRequest = !!(url && url.pathname.includes(NETLIFY_FUNCTION_PREFIX));
      const functionName = isFunctionRequest ? getFunctionName(url) : "";
      try {
        const response = await originalFetch(input, init);
        if (isFunctionRequest) {
          const contentType = response.headers.get("content-type") || "";
          if (!response.ok) {
            const detail = await extractFunctionErrorDetails(response);
            if (shouldNotifyFunctionError(functionName, detail)) {
              showRuntimeBanner(`Backend function "${functionName}" failed`, detail);
            }
          } else if (contentType.includes("text/html")) {
            const detail = "Function returned HTML unexpectedly. Check Netlify function routing and deployment.";
            if (shouldNotifyFunctionError(functionName, detail)) {
              showRuntimeBanner(`Backend function "${functionName}" response issue`, detail);
            }
          }
        }
        return response;
      } catch (error) {
        if (isFunctionRequest) {
          const detail = `${extractErrorMessage(error, "Network error.")} If local, run: npx netlify dev`;
          if (shouldNotifyFunctionError(functionName, detail)) {
            showRuntimeBanner(`Backend function "${functionName}" unreachable`, detail);
          }
        }
        throw error;
      }
    };
  };

  const prefersDark = () => {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (error) {
      return false;
    }
  };

  const readSavedTheme = () => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value === DARK || value === LIGHT) return value;
      return null;
    } catch (error) {
      return null;
    }
  };

  const getInitialTheme = () => readSavedTheme() || DARK;

  const writeTheme = (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
      // Ignore storage failures.
    }
  };

  const applyTheme = (theme) => {
    const mode = theme === DARK ? DARK : LIGHT;
    document.documentElement.setAttribute("data-theme", mode);
    document.documentElement.style.colorScheme = mode;
    const toggle = document.getElementById("themeToggle");
    if (toggle) {
      const nextMode = mode === DARK ? LIGHT : DARK;
      toggle.setAttribute("aria-label", `Switch to ${nextMode} mode`);
      toggle.setAttribute("title", `Switch to ${nextMode} mode`);
      toggle.setAttribute("data-theme", mode);
      let label = toggle.querySelector(".theme-toggle-label");
      if (!label) {
        label = document.createElement("span");
        label.className = "theme-toggle-label";
        toggle.insertBefore(label, toggle.firstChild);
      }
      label.textContent = mode === DARK ? "Light mode" : "Dark mode";
    }
  };

  const POSITION_KEY = "timzee-theme-toggle-pos";
  const COLLAPSED_KEY = "timzee-theme-toggle-collapsed";

  const readSavedPosition = () => {
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.right === "number" && typeof parsed?.bottom === "number") return parsed;
      return null;
    } catch (error) {
      return null;
    }
  };

  const writeSavedPosition = (pos) => {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
    } catch (error) {
      // Ignore storage failures.
    }
  };

  const clampPosition = (right, bottom, el) => {
    const width = el.offsetWidth || 120;
    const height = el.offsetHeight || 42;
    const maxRight = Math.max(4, window.innerWidth - width - 4);
    const maxBottom = Math.max(4, window.innerHeight - height - 4);
    return {
      right: Math.min(Math.max(4, right), maxRight),
      bottom: Math.min(Math.max(4, bottom), maxBottom)
    };
  };

  const applySavedPosition = (el) => {
    const saved = readSavedPosition();
    if (!saved) return;
    const clamped = clampPosition(saved.right, saved.bottom, el);
    el.style.right = `${clamped.right}px`;
    el.style.bottom = `${clamped.bottom}px`;
  };

  const makeDraggable = (el) => {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startBottom = 0;

    const getCurrentOffsets = () => {
      const rect = el.getBoundingClientRect();
      return {
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom
      };
    };

    const onPointerDown = (event) => {
      dragging = true;
      moved = false;
      const point = event.touches ? event.touches[0] : event;
      startX = point.clientX;
      startY = point.clientY;
      const current = getCurrentOffsets();
      startRight = current.right;
      startBottom = current.bottom;
      el.style.transition = "none";
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      const point = event.touches ? event.touches[0] : event;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      event.preventDefault();
      const next = clampPosition(startRight - dx, startBottom - dy, el);
      el.style.right = `${next.right}px`;
      el.style.bottom = `${next.bottom}px`;
    };

    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      el.style.transition = "";
      if (moved) {
        const current = getCurrentOffsets();
        writeSavedPosition(current);
        // Prevent the click handler (theme toggle) from firing right after a drag.
        el.dataset.justDragged = "1";
        setTimeout(() => { delete el.dataset.justDragged; }, 50);
      }
    };

    el.addEventListener("mousedown", onPointerDown);
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    el.addEventListener("touchstart", onPointerDown, { passive: true });
    window.addEventListener("touchmove", onPointerMove, { passive: false });
    window.addEventListener("touchend", onPointerUp);

    window.addEventListener("resize", () => {
      const current = getCurrentOffsets();
      const clamped = clampPosition(current.right, current.bottom, el);
      el.style.right = `${clamped.right}px`;
      el.style.bottom = `${clamped.bottom}px`;
    });
  };

  const setCollapsed = (el, collapsed) => {
    el.classList.toggle("theme-toggle-collapsed", collapsed);
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch (error) {
      // Ignore storage failures.
    }
  };

  const createToggle = () => {
    if (!document.body || document.getElementById("themeToggle")) return;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "themeToggle";
    toggle.className = "theme-toggle";

    const collapseBtn = document.createElement("span");
    collapseBtn.className = "theme-toggle-collapse-handle";
    collapseBtn.setAttribute("role", "button");
    collapseBtn.setAttribute("aria-label", "Hide theme button");
    collapseBtn.textContent = "×";
    collapseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setCollapsed(toggle, true);
    });

    toggle.addEventListener("click", (event) => {
      if (toggle.dataset.justDragged) {
        event.preventDefault();
        return;
      }
      if (toggle.classList.contains("theme-toggle-collapsed")) {
        setCollapsed(toggle, false);
        return;
      }
      const current = document.documentElement.getAttribute("data-theme") === DARK ? DARK : LIGHT;
      const next = current === DARK ? LIGHT : DARK;
      applyTheme(next);
      writeTheme(next);
    });

    toggle.appendChild(collapseBtn);
    document.body.appendChild(toggle);
    applyTheme(document.documentElement.getAttribute("data-theme") || getInitialTheme());
    applySavedPosition(toggle);
    makeDraggable(toggle);
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(toggle, true);
    } catch (error) {
      // Ignore storage failures.
    }
  };

  const initial = getInitialTheme();
  applyTheme(initial);
  setupAppUiApi();
  setupGlobalErrorHandlers();
  setupFunctionErrorMonitoring();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createToggle, { once: true });
  } else {
    createToggle();
  }

  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      if (!readSavedTheme()) applyTheme(DARK);
    };
    if (mq.addEventListener) {
      mq.addEventListener("change", listener);
    } else if (mq.addListener) {
      mq.addListener(listener);
    }
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(readSavedTheme() || DARK);
  });
})();
