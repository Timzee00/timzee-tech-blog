(() => {
  const params = new URLSearchParams(location.search);
  const allowedStatuses = new Set(["success", "error", "warning", "info", "pending"]);
  const rawStatus = (params.get("status") || "info").toLowerCase();
  const status = allowedStatuses.has(rawStatus) ? rawStatus : "info";
  const title = (params.get("title") || "Action status").slice(0, 140);
  const message = (params.get("message") || "Your request has been processed.").slice(0, 2000);
  const next = params.get("next") || "index.html";
  const nextLabel = (params.get("nextLabel") || "Continue").slice(0, 40);
  const retry = params.get("retry") || "";

  const safeRelativeUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return "";
      if (!["http:", "https:"].includes(url.protocol)) return "";
      return url.pathname + url.search + url.hash;
    } catch {
      return "";
    }
  };

  const statusLabel = document.getElementById("resultStatus");
  const resultTitle = document.getElementById("resultTitle");
  const resultMessage = document.getElementById("resultMessage");
  const indicator = document.getElementById("resultIndicator");
  const nextLink = document.getElementById("resultNext");
  const retryBtn = document.getElementById("resultRetry");
  const meta = document.getElementById("resultMeta");

  if (statusLabel) statusLabel.textContent = status === "pending" ? "Pending" : status;
  if (resultTitle) resultTitle.textContent = title;
  if (resultMessage) resultMessage.textContent = message;
  if (indicator) {
    indicator.className = `indicator status-${status === "pending" ? "warning" : status}`;
    indicator.textContent = status === "success" ? "✓" : status === "error" ? "!" : status === "pending" ? "…" : "i";
  }

  const safeNext = safeRelativeUrl(next) || "index.html";
  if (nextLink) {
    nextLink.href = safeNext;
    nextLink.textContent = nextLabel;
  }

  const retryUrl = safeRelativeUrl(retry);
  if (retryBtn && retryUrl) {
    retryBtn.hidden = false;
    retryBtn.addEventListener("click", () => { location.href = retryUrl; });
  }

  if (meta && status === "pending") {
    meta.hidden = false;
    meta.textContent = "You can leave this page safely. Check back through your account or return to the previous screen.";
  }
})();
