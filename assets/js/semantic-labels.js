function relabelPinnedChips(root = document) {
  root.querySelectorAll?.(".post-card-header .chip").forEach((chip) => {
    if ((chip.textContent || "").trim().toLowerCase() === "popular") chip.textContent = "Pinned";
  });
}

function boot() {
  relabelPinnedChips();
  const observer = new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) relabelPinnedChips(node);
  })));
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
