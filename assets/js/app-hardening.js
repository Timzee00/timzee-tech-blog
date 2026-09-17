/* Shared client hardening. Keep this module dependency-free so it can run before auth/network features. */
(function initAppHardening() {
  if (typeof window === "undefined" || window.__timzeeAppHardeningReady) return;
  window.__timzeeAppHardeningReady = true;

  const fileSelections = new WeakMap();

  function fileKey(file) {
    return [file.name, file.size, file.lastModified, file.type].join("::");
  }

  function maxFilesFor(input) {
    const requested = Number(input.dataset.maxFiles);
    return Number.isInteger(requested) && requested > 0 ? requested : 8;
  }

  function mergeSelectedFiles(input, selectedFiles) {
    const previous = fileSelections.get(input) || [];
    const merged = [];
    const seen = new Set();
    [...previous, ...Array.from(selectedFiles || [])].forEach((file) => {
      if (!file || seen.has(fileKey(file))) return;
      seen.add(fileKey(file));
      merged.push(file);
    });

    const limited = merged.slice(0, maxFilesFor(input));
    fileSelections.set(input, limited);

    try {
      const transfer = new DataTransfer();
      limited.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
    } catch (error) {
      // Older browsers can reject assigning FileList. Existing page handlers
      // still receive the original selection in that case.
      console.debug("Multi-file merge unavailable:", error);
    }
  }

  function setupMultiFileInputs() {
    document.querySelectorAll('input[type="file"][multiple]').forEach((input) => {
      if (input.dataset.multiFileHardening === "ready") return;
      input.dataset.multiFileHardening = "ready";
      input.addEventListener("change", (event) => {
        mergeSelectedFiles(input, event.target.files);
      }, true);
      input.addEventListener("resetmultifiles", () => {
        fileSelections.delete(input);
      });
    });
  }

  function loginNextUrl() {
    return `${window.location.pathname.split("/").pop() || "index.html"}${window.location.search}${window.location.hash}`;
  }

  function getSellerIdFromListing() {
    const avatar = document.getElementById("sellerAvatar");
    const href = avatar?.getAttribute("href") || "";
    try {
      const url = new URL(href, window.location.href);
      return url.searchParams.get("id") || "";
    } catch {
      return "";
    }
  }

  function showInlineNotice(button, message) {
    let notice = document.getElementById("appHardeningNotice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "appHardeningNotice";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      notice.style.marginTop = "10px";
      notice.style.fontSize = "0.9rem";
      notice.style.color = "var(--color-text-muted, #64748b)";
      button.insertAdjacentElement("afterend", notice);
    }
    notice.textContent = message;
  }

  function setupListingContactFix() {
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("#contactBtn");
      if (!button || !/\/listing\.html$/i.test(window.location.pathname)) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const sellerId = getSellerIdFromListing();
      if (!sellerId) {
        showInlineNotice(button, "Seller contact is unavailable for this listing.");
        return;
      }

      try {
        const { getCurrentUser } = await import("./supabase.js");
        const user = await getCurrentUser();
        if (!user) {
          const next = encodeURIComponent(loginNextUrl());
          window.location.href = `login.html?next=${next}`;
          return;
        }

        if (sellerId === user.id) {
          showInlineNotice(button, "This is your own listing.");
          return;
        }

        window.location.href = `chat.html?user=${encodeURIComponent(sellerId)}`;
      } catch (error) {
        console.error("Seller contact navigation failed:", error);
        showInlineNotice(button, "Unable to open seller contact right now. Please try again.");
      }
    }, true);
  }

  function installVisualConsistency() {
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
    setupMultiFileInputs();
    setupListingContactFix();
    installVisualConsistency();
    const observer = new MutationObserver(() => setupMultiFileInputs());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
