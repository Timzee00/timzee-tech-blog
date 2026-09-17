const CONSENT_KEY = "timzee_cookie_consent";
const STYLE_ID = "timzee-consent-style";
const BANNER_ID = "timzee-consent-banner";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BANNER_ID}{position:fixed;left:16px;right:16px;bottom:16px;z-index:var(--z-toast,110);display:none}
    #${BANNER_ID}.is-visible{display:block}
    .timzee-consent-card{max-width:900px;margin:0 auto;padding:16px 18px;border:1px solid var(--color-border-strong,rgba(15,23,42,.16));border-radius:14px;background:var(--color-surface,#fff);box-shadow:0 16px 40px rgba(15,23,42,.18);display:flex;gap:18px;align-items:center;justify-content:space-between}
    .timzee-consent-copy{min-width:0;color:var(--color-text,#131417);font-size:.9rem;line-height:1.55}
    .timzee-consent-copy strong{display:block;margin-bottom:4px}
    .timzee-consent-copy a{text-decoration:underline}
    .timzee-consent-actions{display:flex;gap:8px;flex:0 0 auto}
    .timzee-consent-actions button{border:1px solid var(--color-border-strong,rgba(15,23,42,.16));background:transparent;color:var(--color-text,#131417);padding:9px 13px;border-radius:10px;font:600 .875rem var(--font-body,system-ui);cursor:pointer;white-space:nowrap}
    .timzee-consent-actions button[data-consent="accept"]{background:var(--color-primary,#0f766e);color:#fff;border-color:transparent}
    @media (max-width:680px){.timzee-consent-card{align-items:stretch;flex-direction:column;gap:12px}.timzee-consent-actions{width:100%}.timzee-consent-actions button{flex:1}}
  `;
  document.head.appendChild(style);
}

function readConsent() {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : "";
  } catch (_) {
    return "";
  }
}

function writeConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch (_) {}
  window.dispatchEvent(new CustomEvent("timzee:consent", { detail: { value } }));
}

function renderBanner() {
  if (document.getElementById(BANNER_ID)) return;
  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "Privacy and cookie notice");
  banner.innerHTML = `
    <div class="timzee-consent-card">
      <div class="timzee-consent-copy">
        <strong>Privacy &amp; cookies</strong>
        We use essential storage to keep the site working and may use optional measurement features when enabled. Read our <a href="privacy.html">Privacy Policy</a> and <a href="cookies.html">Cookie Policy</a>. You can decline optional cookies.
      </div>
      <div class="timzee-consent-actions">
        <button type="button" data-consent="decline">Decline optional</button>
        <button type="button" data-consent="accept">Accept optional</button>
      </div>
    </div>
  `;
  document.body.appendChild(banner);
  banner.querySelectorAll("button[data-consent]").forEach((button) => {
    button.addEventListener("click", () => {
      writeConsent(button.dataset.consent === "accept" ? "accepted" : "declined");
      banner.classList.remove("is-visible");
    });
  });
  if (!readConsent()) requestAnimationFrame(() => banner.classList.add("is-visible"));
}

export function getCookieConsent() {
  return readConsent();
}

if (typeof window !== "undefined") {
  const init = () => {
    injectStyles();
    renderBanner();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}
