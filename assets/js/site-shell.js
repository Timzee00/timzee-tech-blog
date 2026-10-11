import "./ui-controls.js";
import "./image-fallback.js";
import "./nav.js";
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
  addLink("settings.html", "Settings");
}
function updateFooterBrand(name) {
  const wordmark = document.querySelector(".footer-wordmark");
  if (!wordmark) return;
  const parts = String(name || "Timzee Tech Hub").trim().split(/\s+/).filter(Boolean);
  const first = parts.shift() || "Timzee";
  const remaining = parts.join(" ");
  const children = [document.createTextNode(first)];
  if (remaining) {
    const accent = document.createElement("span");
    accent.textContent = remaining;
    children.push(document.createTextNode(" "), accent);
  }
  wordmark.replaceChildren(...children);
}
document.addEventListener("timzee:branding-updated", event => {
  if (event.detail?.siteName) updateFooterBrand(event.detail.siteName);
});

export function ensureSiteFooter() {
  const footer = document.querySelector("footer.footer");
  if (!footer) return;
  const container = footer.querySelector(".container") || footer;
  container.innerHTML = `<div class="footer-top"><a class="footer-wordmark" href="/index.html">Timzee <span>Tech Hub</span></a><p>A place for curious minds. Built around community.</p></div><nav class="footer-links" aria-label="Community links"><a href="/discussion.html">Discussion</a><a href="/newsletter.html">Newsletter</a><a href="/contact.html">Contact</a><a href="/support.html">Support</a></nav>`;
  updateFooterBrand(window.__timzeeSiteBrandName || document.getElementById("siteName")?.textContent || "Timzee Tech Hub");
  const legal = document.createElement("nav"); legal.className = "footer-legal-links"; legal.setAttribute("aria-label", "Legal and accessibility information");
  LEGAL_LINKS.forEach(([label, path]) => { const link = document.createElement("a"); link.href = "/" + path; link.textContent = label; legal.append(link); });
  const cookies = document.createElement("button"); cookies.type = "button"; cookies.className = "footer-cookie-settings"; cookies.textContent = "Cookie settings"; cookies.addEventListener("click", () => window.openCookieSettings?.()); legal.append(cookies);
  container.append(legal);
  const brand = document.createElement("small"); brand.className = "footer-brand"; brand.textContent = BRAND_TEXT; container.append(brand);
}
async function loadPageEnhancements(){const path=currentSitePath();const imports=[import("./experience-preferences.js")];if(path==="discussion.html")imports.push(import("./discussion-discovery.js"));if(path==="chat.html")imports.push(import("./chat-context-menu.js"));if(path==="ai-chat.html")imports.push(import("./ai-context.js"));if(imports.length)await Promise.allSettled(imports);}
function scheduleIdle(task){if(typeof window.requestIdleCallback==="function")window.requestIdleCallback(task,{timeout:900});else window.setTimeout(task,220);}
if(typeof window!=="undefined"){const start=()=>{ensureProductNavigation();ensureSiteFooter();void import("./privacy-consent.js");scheduleIdle(()=>void loadPageEnhancements());};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();}
