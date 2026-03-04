export function createId(prefix = "id") {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function timeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} d ago`;
  return formatDate(value);
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function readingTime(text) {
  const words = countWords(stripHTML(text || ""));
  const minutes = Math.max(1, Math.ceil(words / 220));
  return `${minutes} min read`;
}

function toText(value) {
  return value === null || typeof value === "undefined" ? "" : String(value);
}

export function decodeHtmlEntities(text) {
  const value = toText(text);
  if (!value) return "";
  if (typeof document === "undefined") {
    return value
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#039;/gi, "'");
  }
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

export function stripHTML(text) {
  const decoded = decodeHtmlEntities(text);
  if (!decoded) return "";
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function escapeHTML(text) {
  return toText(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@([a-zA-Z0-9_]{2,32})/g) || [];
  const names = matches.map((match) => match.slice(1).toLowerCase());
  return Array.from(new Set(names));
}

export function linkifyReferences(text) {
  if (!text) return "";
  let output = escapeHTML(text);
  output = output.replace(/(^|\s)@([a-zA-Z0-9_]{2,32})/g, (match, prefix, handle) => {
    return `${prefix}<a class="mention" href="profile.html?username=${handle}">@${handle}</a>`;
  });
  output = output.replace(/#topic:([a-f0-9-]{8,})/gi, (match, id) => {
    return `<a class="topic-ref" href="discussion.html?topic=${id}">${match}</a>`;
  });
  output = output.replace(/#post:([a-f0-9-]{8,})/gi, (match, id) => {
    return `<a class="post-ref" href="post.html?id=${id}">${match}</a>`;
  });
  return output;
}

export function formatContent(text) {
  return formatRichText(text);
}

export function formatRichText(text) {
  if (!text) return "";
  const safe = escapeHTML(text);
  const lines = safe.split(/\r?\n/);
  let html = "";
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      html += "</ul>";
      inUl = false;
    }
    if (inOl) {
      html += "</ol>";
      inOl = false;
    }
  };

  const applyInline = (value) => {
    let output = value;
    output = output.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    output = output.replace(/\*(.+?)\*/g, "<em>$1</em>");
    output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
    output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      const safeUrl = url.startsWith("http://") || url.startsWith("https://") ? url : "";
      if (!safeUrl) return label;
      return `<a href="${safeUrl}" target="_blank" rel="noopener">${label}</a>`;
    });
    return output;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      closeLists();
      return;
    }
    if (line.startsWith("### ")) {
      closeLists();
      html += `<h3>${applyInline(line.slice(4))}</h3>`;
      return;
    }
    if (line.startsWith("## ")) {
      closeLists();
      html += `<h2>${applyInline(line.slice(3))}</h2>`;
      return;
    }
    if (line.startsWith("# ")) {
      closeLists();
      html += `<h1>${applyInline(line.slice(2))}</h1>`;
      return;
    }
    if (line.startsWith("> ")) {
      closeLists();
      html += `<blockquote>${applyInline(line.slice(2))}</blockquote>`;
      return;
    }
    if (/^(\*|-)\s+/.test(line)) {
      if (!inUl) {
        closeLists();
        html += "<ul>";
        inUl = true;
      }
      html += `<li>${applyInline(line.replace(/^(\*|-)\s+/, ""))}</li>`;
      return;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (!inOl) {
        closeLists();
        html += "<ol>";
        inOl = true;
      }
      html += `<li>${applyInline(line.replace(/^\d+\.\s+/, ""))}</li>`;
      return;
    }
    closeLists();
    html += `<p>${applyInline(line)}</p>`;
  });

  closeLists();
  return html;
}

export function toTagArray(text) {
  if (!text) return [];
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map((tag) => tag.toString().trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    const trimmed = tags.trim();
    if (!trimmed || trimmed === "[]") return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((tag) => tag.toString().trim()).filter(Boolean);
        }
      } catch (error) {
        // Fall through to comma-split parsing.
      }
    }
    return trimmed
      .split(",")
      .map((tag) => tag.replace(/^\"|\"$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

export function clampText(text, limit = 120) {
  const value = toText(text);
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
}

export function getQueryParam(name) {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  return params.get(name);
}

export function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function deriveLevel(points = 0) {
  const score = Number(points) || 0;
  if (score >= 700) return { label: "Legend", tier: 4 };
  if (score >= 300) return { label: "Pro", tier: 3 };
  if (score >= 100) return { label: "Rising", tier: 2 };
  return { label: "Starter", tier: 1 };
}

// ----- Security & Debug helpers -----
export function isSafeUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url, window.location.origin);
    return (u.protocol === "http:" || u.protocol === "https:") || url.startsWith("/");
  } catch (e) {
    return false;
  }
}

export function sanitizeHTML(html) {
  if (!html) return "";
  if (typeof DOMPurify !== "undefined" && DOMPurify.sanitize) return DOMPurify.sanitize(String(html));
  // Fallback: basic DOM-based sanitizer (remove script/style and event handlers)
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html), "text/html");
    // Remove potentially dangerous elements
    doc.querySelectorAll("script,style,link").forEach((el) => el.remove());
    // Remove event handler attributes and javascript: hrefs
    const all = doc.querySelectorAll("*");
    all.forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const val = attr.value || "";
        if (name.startsWith("on") || (name === "href" && val.trim().toLowerCase().startsWith("javascript:"))) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return doc.body.innerHTML;
  } catch (e) {
    // As a last resort, escape HTML
    const div = document.createElement("div");
    div.textContent = String(html);
    return div.innerHTML;
  }
}

// Normalize HTML stored as escaped entities or raw HTML, then sanitize
export function normalizeHtml(html) {
  if (!html) return "";
  const input = String(html);
  if (/<[a-z][\s\S]*>/i.test(input)) {
    return sanitizeHTML(input);
  }
  let decoded = input;
  for (let i = 0; i < 2; i += 1) {
    const next = decodeHtmlEntities(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  if (/<[a-z][\s\S]*>/i.test(decoded)) {
    return sanitizeHTML(decoded);
  }
  return escapeHTML(decoded).replace(/\r?\n/g, "<br>");
}

export function extractErrorMessage(error, fallback = "Unknown error.") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  if (error.error_description) return error.error_description;
  if (error.details) return error.details;
  if (error.hint) return error.hint;
  if (error.error && typeof error.error === "object") {
    return extractErrorMessage(error.error, fallback);
  }
  if (error.error && typeof error.error === "string") return error.error;
  return fallback;
}

let lastErrorKey = "";
let lastErrorAt = 0;

function showRuntimeErrorBanner(message) {
  if (typeof document === "undefined") return;
  if (typeof window !== "undefined" && window.appUI?.toast) {
    window.appUI.toast(message, { tone: "error", title: "Error", duration: 7000 });
    return;
  }
  let banner = document.getElementById("runtimeErrorBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "runtimeErrorBanner";
    banner.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:12px 14px;border-radius:10px;background:#7f1d1d;color:#fff;font:500 13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);";
    const host = document.body || document.documentElement;
    if (!host) return;
    host.appendChild(banner);
  }
  banner.textContent = message;
  banner.style.display = "block";
}

export function reportAppError(error, context = "Error") {
  const message = extractErrorMessage(error, "Unexpected error.");
  const key = `${context}:${message}`;
  const now = Date.now();
  if (key === lastErrorKey && now - lastErrorAt < 5000) return;
  lastErrorKey = key;
  lastErrorAt = now;
  console.error(`[${context}]`, error);
  showRuntimeErrorBanner(`${context}: ${message}`);
}

// Simple debug logger gated to localhost or when window.DEBUG is true
export function debug(...args) {
  if (typeof window !== "undefined" && (window.DEBUG === true || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

// Expose helpers globally for inline scripts that aren't modules
if (typeof window !== "undefined") {
  // Attach only if not already defined to avoid overwriting
  if (!window.escapeHTML) window.escapeHTML = (t) => (typeof t === "undefined" ? "" : String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"));
  if (!window.decodeHtmlEntities) window.decodeHtmlEntities = decodeHtmlEntities;
  if (!window.sanitizeHTML) window.sanitizeHTML = sanitizeHTML;
  if (!window.normalizeHtml) window.normalizeHtml = normalizeHtml;
  if (!window.extractErrorMessage) window.extractErrorMessage = extractErrorMessage;
  if (!window.reportAppError) window.reportAppError = reportAppError;
  if (!window.isSafeUrl) window.isSafeUrl = isSafeUrl;
  if (!window.debug) window.debug = debug;
}
