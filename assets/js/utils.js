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

export function stripHTML(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>/g, " ");
}

export function escapeHTML(text) {
  return text
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
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

export function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
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
  // Fallback: escape HTML to prevent XSS
  const div = document.createElement("div");
  div.textContent = String(html);
  return div.innerHTML;
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
  if (!window.sanitizeHTML) window.sanitizeHTML = sanitizeHTML;
  if (!window.isSafeUrl) window.isSafeUrl = isSafeUrl;
  if (!window.debug) window.debug = debug;
}
