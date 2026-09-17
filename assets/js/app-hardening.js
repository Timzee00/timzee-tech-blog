/* Shared client hardening. Page-specific state stays with each feature. */
(function initAppHardening() {
  if (typeof window === "undefined" || window.__timzeeAppHardeningReady) return;
  window.__timzeeAppHardeningReady = true;

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installVisualConsistency, { once: true });
  } else {
    installVisualConsistency();
  }
})();
