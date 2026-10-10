import "./ui-controls.js";
import "./nav.js";
import { pageFileName } from "./route-page.mjs";

const BRAND_TEXT="Powered by Timzee Corp";
const LEGAL_LINKS=[["Privacy","privacy.html"],["Terms","terms.html"],["Refund Policy","refund-policy.html"],["Cookies","cookies.html"],["Accessibility","accessibility.html"]];
function currentSitePath(){return pageFileName(window.location.pathname||"");}
function ensureProductNavigation(){const menu=document.querySelector(".nav-more-menu");if(!menu)return;const addLink=(href,label)=>{if(menu.querySelector(`a[href="${href}"]`))return;const link=document.createElement("a");link.href=new URL(href,location.origin+"/").href;link.textContent=label;menu.insertBefore(link,menu.firstChild);};addLink("fyp.html","For You");addLink("settings.html","Settings");}
export function ensureSiteFooter() {
  const footer = document.querySelector("footer.footer");
  if (!footer) return;
  const container = footer.querySelector(".container") || footer;
  container.innerHTML = `<div class="footer-top"><a class="footer-wordmark" href="/index.html">Timzee <span>Tech Hub</span></a><p>A place for curious minds. Built around community.</p></div><nav class="footer-links" aria-label="Community links"><a href="/discussion.html">Discussion</a><a href="/newsletter.html">Newsletter</a><a href="/contact.html">Contact</a><a href="/support.html">Support</a></nav>`;
  const legal = document.createElement("nav"); legal.className = "footer-legal-links"; legal.setAttribute("aria-label", "Legal and accessibility information");
  LEGAL_LINKS.forEach(([label, path]) => { const link = document.createElement("a"); link.href = "/" + path; link.textContent = label; legal.append(link); });
  const cookies = document.createElement("button"); cookies.type = "button"; cookies.className = "footer-cookie-settings"; cookies.textContent = "Cookie settings"; cookies.addEventListener("click", () => window.openCookieSettings?.()); legal.append(cookies);
  container.append(legal);
  const brand = document.createElement("small"); brand.className = "footer-brand"; brand.textContent = BRAND_TEXT; container.append(brand);
}
async function loadPageEnhancements(){const path=currentSitePath();const imports=[import("./experience-preferences.js")];if(path==="discussion.html")imports.push(import("./discussion-discovery.js"));if(path==="chat.html")imports.push(import("./chat-context-menu.js"));if(path==="ai-chat.html")imports.push(import("./ai-context.js"));if(imports.length)await Promise.allSettled(imports);}
function scheduleIdle(task){if(typeof window.requestIdleCallback==="function")window.requestIdleCallback(task,{timeout:900});else window.setTimeout(task,220);}
if(typeof window!=="undefined"){const start=()=>{ensureProductNavigation();ensureSiteFooter();void import("./privacy-consent.js");scheduleIdle(()=>void loadPageEnhancements());};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();}
