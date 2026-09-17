const BRAND_TEXT = "Powered by Timzee Corp";
const LEGAL_LINKS = [
  ["Privacy", "privacy.html"],
  ["Terms", "terms.html"],
  ["Refund Policy", "refund-policy.html"],
  ["Cookies", "cookies.html"],
  ["Accessibility", "accessibility.html"]
];

function currentSitePath() {
  return window.location.pathname || "";
}

export function ensureSiteFooter() {
  const footer = document.querySelector("footer.footer");
  if (!footer) return;
  const container = footer.querySelector(".container") || footer;

  let brand = container.querySelector("[data-site-brand]");
  if (!brand) {
    brand = document.createElement("div");
    brand.dataset.siteBrand = "true";
    brand.className = "footer-brand";
    container.insertBefore(brand, container.firstChild);
  }
  brand.textContent = BRAND_TEXT;

  let legal = container.querySelector("[data-site-legal]");
  if (!legal) {
    legal = document.createElement("nav");
    legal.dataset.siteLegal = "true";
    legal.className = "footer-legal-links";
    legal.setAttribute("aria-label", "Legal and accessibility information");
    container.appendChild(legal);
  }
  legal.replaceChildren(
    ...LEGAL_LINKS.map(([label, href]) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      return link;
    })
  );

  const path = currentSitePath().toLowerCase();
  const oldText = Array.from(container.querySelectorAll("div, p, span"));
  oldText.forEach((node) => {
    if (node === brand || node.closest("[data-site-legal]")) return;
    if ((node.textContent || "").includes("Powered by Timzee-Tech")) {
      node.textContent = BRAND_TEXT;
    }
  });

  if (/\/privacy\.html$/.test(path) || /\/terms\.html$/.test(path) || /\/refund-policy\.html$/.test(path) || /\/cookies\.html$/.test(path) || /\/accessibility\.html$/.test(path)) {
    brand.setAttribute("aria-current", "page");
  }
}

if (typeof window !== "undefined") {
  const start = () => ensureSiteFooter();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
