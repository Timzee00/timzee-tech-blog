/* Shared theme and feedback primitives. Loaded before feature modules. */
(() => {
  const KEY = "timzee-theme";
  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme(mode) {
    const theme = mode === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll("[data-theme-control]").forEach(button => {
      const label = theme === "dark" ? "Light mode" : "Dark mode";
      button.textContent = label;
      button.setAttribute("aria-label", `Switch to ${label.toLowerCase()}`);
    });
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch { /* The session still works without storage. */ }
    applyTheme(next);
  }
  applyTheme(saved() || (system.matches ? "dark" : "light"));
  system.addEventListener("change", () => { if (!saved()) applyTheme(system.matches ? "dark" : "light"); });
  window.addEventListener("storage", event => { if (event.key === KEY) applyTheme(saved() || (system.matches ? "dark" : "light")); });

  function toast(message, options = {}) {
    if (!String(message ?? "").trim()) return;
    let root = document.getElementById("appToastRoot");
    if (!root) {
      root = document.createElement("div"); root.id = "appToastRoot"; root.className = "app-toast-root";
      document.body.append(root);
    }
    const card = document.createElement("div");
    const tone = options.tone || options.type || "info";
    card.className = `app-toast ${["info", "success", "warning", "error"].includes(tone) ? tone : "info"}`;
    card.setAttribute("role", tone === "error" ? "alert" : "status");
    const content = document.createElement("div");
    if (options.title) { const heading = document.createElement("strong"); heading.textContent = options.title; content.append(heading); }
    const text = document.createElement("p"); text.textContent = message; content.append(text);
    const close = document.createElement("button"); close.type = "button"; close.className = "toast-close";
    close.textContent = "×"; close.setAttribute("aria-label", "Dismiss notification");
    close.addEventListener("click", () => card.remove());
    card.append(content, close); root.append(card);
    while (root.children.length > 3) root.firstElementChild.remove();
    let timer;
    const schedule = () => { if (options.duration !== 0) timer = setTimeout(() => card.remove(), options.duration || 6500); };
    card.addEventListener("mouseenter", () => clearTimeout(timer));
    card.addEventListener("focusin", () => clearTimeout(timer));
    card.addEventListener("mouseleave", schedule); card.addEventListener("focusout", schedule); schedule();
    return card;
  }

  // Browser <dialog> provides focus containment, background inertness and Escape.
  // Queue requests so repeated actions cannot stack several confirmations.
  let pending = Promise.resolve();
  function dialog(mode, message, options = {}) {
    if (typeof options === "string") options = { defaultValue: options };
    const open = () => new Promise(resolve => {
      const previous = document.activeElement;
      const element = document.createElement("dialog"); element.className = "app-dialog";
      const title = document.createElement("h2"); title.id = "appDialogTitle";
      title.textContent = options.title || (mode === "confirm" ? "Confirm action" : mode === "prompt" ? "Your response" : "Notice");
      const description = document.createElement("p"); description.id = "appDialogDescription"; description.textContent = message;
      element.setAttribute("aria-labelledby", title.id); element.setAttribute("aria-describedby", description.id);
      element.append(title, description);
      let input;
      if (mode === "prompt") {
        const label = document.createElement("label"); label.htmlFor = "appDialogInput"; label.textContent = options.label || "Response";
        input = document.createElement("input"); input.id = label.htmlFor; input.type = options.inputType || "text";
        input.value = options.defaultValue || ""; input.placeholder = options.placeholder || "";
        if (input.type === "password") input.autocomplete = "new-password";
        element.append(label, input);
      }
      const actions = document.createElement("div"); actions.className = "app-dialog-actions";
      let value = mode === "confirm" ? false : null;
      const finish = result => { value = result; element.close(); };
      if (mode !== "alert") {
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn ghost";
        cancel.textContent = options.cancelText || "Cancel"; cancel.autofocus = !input;
        cancel.addEventListener("click", () => finish(mode === "confirm" ? false : null)); actions.append(cancel);
      }
      const accept = document.createElement("button"); accept.type = "button"; accept.className = "btn";
      accept.textContent = options.confirmText || (mode === "confirm" ? "Confirm" : "Continue");
      accept.addEventListener("click", () => finish(mode === "prompt" ? input.value : mode === "confirm" ? true : undefined));
      actions.append(accept); element.append(actions); document.body.append(element);
      element.addEventListener("close", () => { element.remove(); previous?.focus?.({ preventScroll: true }); resolve(value); }, { once: true });
      input?.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); accept.click(); } });
      element.showModal(); if (input) input.focus();
    });
    const result = pending.then(open); pending = result.catch(() => {}); return result;
  }
  window.appUI = { toast, alert: (m, o) => dialog("alert", m, o), confirm: (m, o) => dialog("confirm", m, o), prompt: (m, o) => dialog("prompt", m, o), toggleTheme };
  window.siteToast = toast;
  window.siteNotice = (message, type = "info", title = "") => toast(message, { tone: type, title });

  let lastError = 0;
  const handleError = error => {
    const message = String(error?.message || error || "");
    // This browser layout warning is nonfatal. It must not claim that the
    // application failed or frighten someone away from using chat.
    if (/^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i.test(message)) return;
    console.error("Timzee client error:", error);
    if (Date.now() - lastError < 20000) return;
    lastError = Date.now();
    toast("Something could not load. Please refresh the page and try again.", { tone: "error", title: "Something went wrong" });
  };
  window.__timzeeErrorHandlersReady = true;
  window.addEventListener("error", event => handleError(event.error || event.message));
  window.addEventListener("unhandledrejection", event => handleError(event.reason));
  function mountThemeControl() {
    if (document.getElementById("themeToggle")) return;
    const target = document.querySelector(".site-header .wrap") || document.querySelector("footer .container");
    if (!target) return;
    const button = document.createElement("button"); button.type = "button"; button.id = "themeToggle";
    button.className = "theme-control"; button.dataset.themeControl = "true";
    button.addEventListener("click", toggleTheme); target.append(button);
    applyTheme(document.documentElement.dataset.theme);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountThemeControl, { once: true });
  else mountThemeControl();
})();
