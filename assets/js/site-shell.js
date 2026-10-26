import "./ui-controls.js";
import "./image-fallback.js";
import "./nav.js";
import "./space-mini-dock.mjs";
import "./visitor-analytics.js";
import { pageFileName } from "./route-page.mjs";

const BRAND_TEXT="Powered by Timzee Corp";
const LEGAL_LINKS=[["Privacy","privacy.html"],["Terms","terms.html"],["Refund Policy","refund-policy.html"],["Cookies","cookies.html"],["Accessibility","accessibility.html"]];
function currentSitePath(){return pageFileName(window.location.pathname||"");}
function ensureProductNavigation(){
  const menu = document.querySelector(".nav-more-menu");
  if (!menu) return;
  const current = currentSitePath();
  const addLink = (href, label) => {
    let link = [...menu.querySelectorAll("a[href]")].find(node => pageFileName(new URL(node.href).pathname) === href);
    if (!link) {
      link = document.createElement("a");
      link.href = "/" + href;
      link.textContent = label;
      menu.insertBefore(link, menu.firstChild);
    }
    if (href === current) {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
      menu.closest(".nav-more")?.querySelector(".nav-more-toggle")?.classList.add("active-parent");
    }
  };
  addLink("fyp.html", "For You");
  addLink("launches.html", "Coming Soon");
  addLink("settings.html", "Settings");
}
function createBlipmoodWordmark() {
  // Construct the same app mark and play-in-i lettering for every public header/footer.
  // This does not replace data-backed navigation, auth or settings controls.
  const wrap = document.createElement("span");
  wrap.className = "bm-brand-display";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = '<img class="bm-logo-icon" src="/assets/brand/blipmood-mark.svg" width="44" height="44" alt="" decoding="async">' +
    '<span class="bm-wordmark">Bl<span class="bm-play-i"><svg viewBox="0 0 22 22" aria-hidden="true" focusable="false"><path d="M5 2 Q3 2 3 5 V17 Q3 20 6 20 L19 12 Q21 11 19 9 Z"/></svg></span>pmood</span>';
  return wrap;
}
function ensureBlipmoodHeader() {
  const headerBrand = document.querySelector(".site-header a.brand");
  if (!headerBrand) return;
  if (!headerBrand.querySelector(".bm-brand-display")) headerBrand.prepend(createBlipmoodWordmark());
  headerBrand.setAttribute("aria-label", "Blipmood — Home");
  headerBrand.querySelector("#siteName")?.setAttribute("aria-hidden", "true");
}
function updateFooterBrand(name) {
  const wordmark = document.querySelector(".footer-wordmark");
  if (!wordmark) return;
  const productName = String(name || "Blipmood").trim();
  wordmark.setAttribute("aria-label", productName + " — Home");
  if (productName === "Blipmood") wordmark.replaceChildren(createBlipmoodWordmark());
  else wordmark.replaceChildren(document.createTextNode(productName));
}
document.addEventListener("timzee:branding-updated", event => {
  if (event.detail?.siteName) updateFooterBrand(event.detail.siteName);
});

export function ensureSiteFooter() {
  const footer = document.querySelector("footer.footer");
  if (!footer) return;
  const container = footer.querySelector(".container") || footer;
  if (footer.dataset.timzeeShellReady === "true") {
    updateFooterBrand(window.__timzeeSiteBrandName || document.getElementById("siteName")?.textContent || "Blipmood");
    return;
  }
  // Preserve feature-specific destinations such as "Back to Marketplace" or
  // "Report Problem" before replacing legacy link markup with common chrome.
  const standardLabels = new Set(["discussion", "newsletter", "contact", "contact us", "support", "advertise"]);
  const contextualLinks = [];
  const seen = new Set();
  for (const link of footer.querySelectorAll(".footer-links a[href]")) {
    const label = link.textContent.trim();
    if (!label || standardLabels.has(label.toLowerCase())) continue;
    try {
      const destination = new URL(link.getAttribute("href"), document.baseURI);
      if (destination.origin !== location.origin || !["https:", "http:"].includes(destination.protocol)) continue;
      const key = label.toLowerCase() + "|" + destination.href;
      if (seen.has(key)) continue;
      seen.add(key);
      contextualLinks.push({ label, href: destination.href });
    } catch { /* Ignore malformed footer links. */ }
    if (contextualLinks.length >= 8) break;
  }
  container.innerHTML = `<div class="footer-top"><a class="footer-wordmark" href="/index.html">Blipmood</a><p>A place for curious minds. Built around community.</p></div><nav class="footer-links" aria-label="Community links"><a href="/fyp.html">For You</a><a href="/video.html">Reels</a><a href="/discussion.html">Discussion</a><a href="/marketplace.html">Marketplace</a><a href="/newsletter.html">Newsletter</a><a href="/contact.html">Contact</a><a href="/support.html">Support</a></nav>`;
  footer.dataset.timzeeShellReady = "true";
  updateFooterBrand(window.__timzeeSiteBrandName || document.getElementById("siteName")?.textContent || "Blipmood");
  if (contextualLinks.length) {
    const contextual = document.createElement("nav");
    contextual.className = "footer-context-links";
    contextual.setAttribute("aria-label", "Page actions");
    for (const { href, label } of contextualLinks) {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      contextual.appendChild(link);
    }
    container.append(contextual);
  }
  const legal = document.createElement("nav"); legal.className = "footer-legal-links"; legal.setAttribute("aria-label", "Legal and accessibility information");
  LEGAL_LINKS.forEach(([label, path]) => { const link = document.createElement("a"); link.href = "/" + path; link.textContent = label; legal.append(link); });
  const cookies = document.createElement("button");
  cookies.type = "button";
  cookies.className = "footer-cookie-settings";
  cookies.textContent = "Cookie settings";
  cookies.addEventListener("click", async () => {
    // Dynamic module loading must complete before attempting to open the modal.
    try {
      await import("./privacy-consent.js");
      if (typeof window.openCookieSettings !== "function") throw Error("Consent controls unavailable");
      window.openCookieSettings();
    } catch (error) {
      console.warn("Cookie preferences could not load:", error);
      const status = document.createElement("span");
      status.className = "footer-cookie-error";
      status.setAttribute("role", "status");
      status.textContent = "Cookie settings are unavailable. Reload this page to try again.";
      cookies.after(status);
    }
  });
  legal.append(cookies);
  container.append(legal);
  const brand = document.createElement("small"); brand.className = "footer-brand"; brand.textContent = BRAND_TEXT; container.append(brand);
}
async function loadPageEnhancements(){const path=currentSitePath();const imports=[import("./experience-preferences.js"),import("./launch-context.mjs")];if(path==="discussion.html")imports.push(import("./discussion-discovery.js"));if(path==="chat.html")imports.push(import("./chat-context-menu.js"));if(path==="ai-chat.html")imports.push(import("./ai-context.js"));if(imports.length)await Promise.allSettled(imports);}
function scheduleIdle(task){if(typeof window.requestIdleCallback==="function")window.requestIdleCallback(task,{timeout:900});else window.setTimeout(task,220);}
if(typeof window!=="undefined"){const start=()=>{ensureBlipmoodHeader();ensureProductNavigation();ensureSiteFooter();void import("./privacy-consent.js");scheduleIdle(()=>void loadPageEnhancements());};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();}
