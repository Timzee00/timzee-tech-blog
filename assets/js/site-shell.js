import "./ui-controls.js";
import "./image-fallback.js";
import "./nav.js";
import "./blipmood-unified-menu.mjs";
import "./space-mini-dock.mjs";
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
// Approved raster artwork: play-button 'i', expressive double-'oo', brush underline.
// The build downloads and checksum-verifies these into first-party /assets/brand URLs.
const BRAND_IMAGES = {
  wordmark: {light:"https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/809f2766-cefa-4133-9be0-a9e34a79ea67.png",dark:"https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/1edfccf6-fdc1-409c-b9c5-162b23657600.png"},
  emblem: {light:"https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/cb2e26bb-2d48-471d-80fc-67d8ffc1b06b.png",dark:"https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/fc802f03-1c6f-4c85-ab4c-a31f4a6b2981.png"}
};
function currentBrandTheme() {return document.documentElement.dataset.theme === "light" ? "light" : "dark";}
function synchronizeBrandImages() {
  const theme=currentBrandTheme();
  document.querySelectorAll("img[data-bm-logo]").forEach(img => {
    const kind=img.dataset.bmLogo;
    if(!Object.hasOwn(BRAND_IMAGES,kind))return;
    if(kind==="emblem"&&img.dataset.bmResponsiveHero==="true"){
      // Keep responsive variants in the selected site theme: don't replace
      // a 180px mobile image with the oversized original PNG during hydration.
      const version=img.getAttribute("srcset")?.match(/\?v=([a-f0-9]{16})/)?.[1]||
        img.getAttribute("src")?.match(/\?v=([a-f0-9]{16})/)?.[1]||"";
      const suffix=version?"?v="+version:"";
      const root="/assets/brand/blipmood-emblem-"+theme+"-";
      const src=root+"420.png"+suffix;
      const srcset=root+"180.png"+suffix+" 180w, "+root+"420.png"+suffix+" 420w";
      if(img.getAttribute("srcset")!==srcset)img.setAttribute("srcset",srcset);
      if(img.getAttribute("src")!==src)img.setAttribute("src",src);
      return;
    }
    const src=BRAND_IMAGES[kind][theme];
    if(img.getAttribute("src")!==src)img.setAttribute("src",src);
  });
}
function createBlipmoodWordmark() {
  const wrap=document.createElement("span");
  wrap.className="bm-brand-display";
  wrap.setAttribute("aria-hidden","true");
  const img=document.createElement("img");
  img.className="bm-wordmark-image";
  img.dataset.bmLogo="wordmark";
  img.src=BRAND_IMAGES.wordmark[currentBrandTheme()];
  img.alt=""; img.width=210; img.height=70; img.decoding="async";
  wrap.appendChild(img);
  return wrap;
}
function ensureBlipmoodHeader() {
  const headerBrand=document.querySelector(".site-header a.brand");
  if(!headerBrand)return;
  // Source templates still contain fallback .logo spans. Prepending the PNG
  // left both the custom wordmark and ordinary text visible on pages without
  // #siteName (e.g. Spaces). Keep exactly one brand child on every route.
  const wordmark=headerBrand.querySelector(":scope > .bm-brand-display")||createBlipmoodWordmark();
  headerBrand.replaceChildren(wordmark);
  headerBrand.setAttribute("aria-label","Blipmood — Home");
  synchronizeBrandImages();
}
function updateFooterBrand() {
  const wordmark=document.querySelector(".footer-wordmark");
  if(!wordmark)return;
  wordmark.setAttribute("aria-label","Blipmood — Home");
  wordmark.replaceChildren(createBlipmoodWordmark());
}
document.addEventListener("timzee:branding-updated", () => updateFooterBrand());

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
  if(currentSitePath()==="index.html"){
    const replay=document.createElement("button");
    replay.type="button";
    replay.className="footer-cookie-settings";
    replay.textContent="Replay intro";
    replay.addEventListener("click",()=>{
      void import("./blipmood-intro.mjs").then(mod=>mod.playIntro({force:true}))
        .catch(()=>{window.appUI?.showToast?.("Intro unavailable right now.");});
    });
    legal.append(replay);
    const welcome=document.createElement("button");
    welcome.type="button";
    welcome.className="footer-cookie-settings";
    welcome.textContent="Replay welcome";
    welcome.addEventListener("click",()=>{
      void import("./blipmood-welcome.mjs").then(mod=>{
        if(!mod.openWelcome({force:true}))window.appUI?.showToast?.("Close the other dialog first to replay the welcome.");
      }).catch(()=>{window.appUI?.showToast?.("Welcome unavailable right now.");});
    });
    legal.append(welcome);
  }
  container.append(legal);
  const brand = document.createElement("small"); brand.className = "footer-brand"; brand.textContent = BRAND_TEXT; container.append(brand);
}
async function loadPageEnhancements(){const path=currentSitePath();const imports=[import("./experience-preferences.js"),import("./launch-context.mjs")];if(path==="discussion.html")imports.push(import("./discussion-discovery.js"));if(path==="chat.html")imports.push(import("./chat-context-menu.js"));if(path==="ai-chat.html")imports.push(import("./ai-context.js"));if(imports.length)await Promise.allSettled(imports);}
function scheduleIdle(task){if(typeof window.requestIdleCallback==="function")window.requestIdleCallback(task,{timeout:900});else window.setTimeout(task,220);}
/* Preserve the approved animated site name on mobile AND desktop.
 * Load it after first paint instead of downloading the layered artwork in
 * the render-critical path. Respect explicit reduced-motion/data-saving. */
function scheduleDecorativeBrand() {
 const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
 if(connection?.saveData || /(?:slow-2g|2g)/.test(connection?.effectiveType||"") ||
   document.documentElement.dataset.reduceMotion==="true" ||
   window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)return;
 window.setTimeout(()=>{
   scheduleIdle(()=>void import("./animated-brand.mjs")
     .then(module=>module.enhanceAnimatedHeader()).catch(()=>{}));
 },1200);
}
/* On first visit, restore the original cinematic intro on mobile too.
 * Existing cookie consent and official graphic announcements take priority,
 * but dismissing those prompts resumes rather than permanently cancels the
 * welcome sequence. Only one full-screen experience is shown at once. */
function scheduleHomeCampaign(){
 const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
 if(connection?.saveData || /(?:slow-2g|2g)/.test(connection?.effectiveType||"") ||
    document.documentElement.dataset.reduceMotion==="true" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)return;
 let introPlanned=false;
 try{introPlanned=localStorage.getItem("blipmood:intro:seen:v1")!=="1";}
 catch{/* If private storage is blocked, manual Replay intro remains available. */}
 function whenOverlayClear(action,delay){
   let done=false;
   const retry=()=>window.setTimeout(check,180);
   const blocked=()=>document.visibilityState==="hidden" ||
     Boolean(document.querySelector("#timzee-consent-banner.is-visible, #timzee-cookie-settings-modal[open], #siteAnnouncementBackdrop, #bm-cinema-intro, #bmWelcomeModal"));
   function check(){
     if(done||blocked())return;
     done=true;
     window.removeEventListener("timzee:consent",retry);
     document.removeEventListener("click",retry);
     document.removeEventListener("visibilitychange",retry);
     scheduleIdle(action);
   }
   window.addEventListener("timzee:consent",retry);
   document.addEventListener("click",retry);
   document.addEventListener("visibilitychange",retry);
   window.setTimeout(check,delay);
 }
 const welcome=()=>whenOverlayClear(()=>{
   void import("./blipmood-welcome.mjs")
     .then(module=>module.openWelcome()).catch(()=>{});
 },1400);
 if(introPlanned){
   whenOverlayClear(()=>{
     void import("./blipmood-intro.mjs")
       .then(module=>module.playIntro())
       .then(played=>{
         // Wait for the original 3.9-second cinematic and exit transition
         // before introducing the optional guest welcome banner.
         if(played)window.setTimeout(welcome,5100);
         else welcome();
       }).catch(welcome);
   },1500);
 }else{
   welcome();
 }
}
if(typeof window!=="undefined"){
 const start=()=>{
   ensureBlipmoodHeader();
   ensureProductNavigation();
   ensureSiteFooter();
   synchronizeBrandImages();
   new MutationObserver(synchronizeBrandImages)
     .observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
   void import("./privacy-consent.js");
   scheduleIdle(()=>{
      void loadPageEnhancements();
      void import("./visitor-analytics.js").catch(()=>{});
   });
   scheduleDecorativeBrand();
   if(currentSitePath()==="index.html")scheduleHomeCampaign();
 };
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
 else start();
}
