const CONSENT_KEY = "timzee_cookie_consent";
const CONSENT_COOKIE = "timzee_cookie_consent";
const PREFERENCES_COOKIE = "timzee_preferences_enabled";
const MEASUREMENT_COOKIE = "timzee_measurement_optin";
const STYLE_ID = "timzee-consent-style";
const BANNER_ID = "timzee-consent-banner";
const MODAL_ID = "timzee-cookie-settings-modal";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BANNER_ID}{position:fixed;left:16px;right:16px;bottom:calc(88px + env(safe-area-inset-bottom));z-index:100000;display:none}
    #${BANNER_ID}.is-visible{display:block}
    .timzee-consent-card{max-width:980px;margin:0 auto;padding:18px 20px;border:1px solid var(--color-border-strong,rgba(15,23,42,.16));border-radius:14px;background:var(--color-surface,#fff);color:var(--color-text,#131417);box-shadow:0 16px 40px rgba(15,23,42,.18);display:flex;gap:20px;align-items:flex-end;justify-content:space-between}
    .timzee-consent-copy{min-width:0;font-size:.9rem;line-height:1.55}.timzee-consent-copy strong{display:block;margin-bottom:5px}.timzee-consent-copy a{text-decoration:underline}
    .timzee-consent-actions{display:flex;gap:8px;flex:0 0 auto;flex-wrap:wrap}.timzee-consent-actions button{border:1px solid var(--color-border-strong,rgba(15,23,42,.16));background:transparent;color:var(--color-text,#131417);padding:9px 13px;border-radius:10px;font:600 .84rem var(--font-body,system-ui);cursor:pointer;white-space:nowrap}.timzee-consent-actions button[data-consent="accept"]{background:var(--color-primary,#0f766e);color:#fff;border-color:transparent}
    .timzee-consent-manage{display:inline-block;margin:8px 0 0;padding:0;border:0;background:none;font:600 .78rem var(--font-body,system-ui);text-decoration:underline;cursor:pointer;color:inherit}
    #${MODAL_ID}{position:fixed;inset:0;z-index:100001;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.55);backdrop-filter:blur(5px)}
    .timzee-cookie-modal-card{width:min(520px,100%);padding:22px;border:1px solid var(--color-border-strong,rgba(15,23,42,.16));border-radius:18px;background:var(--color-surface,#fff);color:var(--color-text,#131417);box-shadow:0 24px 70px rgba(15,23,42,.28)}
    .timzee-cookie-modal-card h2{margin:0 0 7px;font:700 1.25rem var(--font-display,system-ui)}
    .timzee-cookie-modal-card p{margin:0 0 16px;color:var(--color-text-muted,#667085);font-size:.86rem;line-height:1.55}
    .timzee-cookie-option{display:flex;gap:11px;align-items:flex-start;padding:12px;border:1px solid var(--color-border,rgba(15,23,42,.1));border-radius:12px;margin-top:9px}
    .timzee-cookie-option input{margin-top:3px}.timzee-cookie-option strong{display:block;font-size:.86rem}.timzee-cookie-option small{display:block;margin-top:2px;color:var(--color-text-muted,#667085);line-height:1.4}
    .timzee-cookie-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;flex-wrap:wrap}.timzee-cookie-modal-actions button{padding:9px 13px;border-radius:10px;border:1px solid var(--color-border-strong,rgba(15,23,42,.16));background:transparent;font:600 .82rem var(--font-body,system-ui);cursor:pointer}.timzee-cookie-modal-actions .primary{background:var(--color-primary,#0f766e);color:#fff;border-color:transparent}
    @media (max-width:680px){#${BANNER_ID}{left:10px;right:10px;bottom:calc(76px + env(safe-area-inset-bottom))}.timzee-consent-card{align-items:stretch;flex-direction:column;gap:12px}.timzee-consent-actions{width:100%}.timzee-consent-actions button{flex:1;min-width:0}}
  `;
  document.head.appendChild(style);
}

function getCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}
function setCookie(name, value, maxAge = COOKIE_MAX_AGE) { document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax; Secure`; }
function removeCookie(name) { document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/; SameSite=Lax; Secure`; }
function readConsent() {
  try {
    const local = localStorage.getItem(CONSENT_KEY) || "";
    const cookie = getCookie(CONSENT_COOKIE);
    return local === "accepted" || local === "declined" ? local : cookie;
  } catch (_) { return getCookie(CONSENT_COOKIE); }
}
function writeConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch (_) {}
  setCookie(CONSENT_COOKIE, value);
  setCookie(PREFERENCES_COOKIE, value === "accepted" ? "1" : "0");
  if (value === "accepted") setCookie(MEASUREMENT_COOKIE, "1"); else removeCookie(MEASUREMENT_COOKIE);
  window.dispatchEvent(new CustomEvent("timzee:consent", { detail: { value } }));
}

function closeCookieModal() { document.getElementById(MODAL_ID)?.remove(); }
function openCookieSettings() {
  injectStyles();
  closeCookieModal();
  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="timzee-cookie-modal-card">
      <h2>Cookie preferences</h2>
      <p>Choose which optional storage Timzee Tech Hub may use. Essential storage stays enabled because it supports login, security and core features.</p>
      <label class="timzee-cookie-option"><input type="checkbox" checked disabled><span><strong>Essential</strong><small>Required for authentication, security and core site functions.</small></span></label>
      <label class="timzee-cookie-option"><input id="timzeePreferenceChoice" type="checkbox" ${readConsent() === "accepted" ? "checked" : ""}><span><strong>Preferences</strong><small>Remembers interface and product preferences.</small></span></label>
      <label class="timzee-cookie-option"><input id="timzeeMeasurementChoice" type="checkbox" ${readConsent() === "accepted" ? "checked" : ""}><span><strong>Measurement</strong><small>Optional usage measurement that helps improve the site.</small></span></label>
      <div class="timzee-cookie-modal-actions"><button type="button" data-cookie-close>Cancel</button><button type="button" class="primary" data-cookie-save>Save choices</button></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-cookie-close]")) closeCookieModal();
    if (event.target.closest("[data-cookie-save]")) {
      const accepted = Boolean(document.getElementById("timzeePreferenceChoice")?.checked || document.getElementById("timzeeMeasurementChoice")?.checked);
      writeConsent(accepted ? "accepted" : "declined");
      closeCookieModal();
      document.getElementById(BANNER_ID)?.classList.remove("is-visible");
    }
  });
}

function renderBanner(force = false) {
  let banner = document.getElementById(BANNER_ID);
  if (!banner) {
    banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Privacy and cookie notice");
    document.body.appendChild(banner);
    banner.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-consent]");
      if (!button) return;
      const choice = button.dataset.consent;
      if (choice === "manage") return openCookieSettings();
      writeConsent(choice === "accept" ? "accepted" : "declined");
      banner.classList.remove("is-visible");
    });
  }
  banner.innerHTML = `
    <div class="timzee-consent-card">
      <div class="timzee-consent-copy"><strong>Privacy & cookies</strong>We use essential storage for login, security and core features. Optional preference and measurement cookies are enabled only after you choose to accept them. <a href="privacy.html">Privacy Policy</a> · <a href="cookies.html">Cookie Policy</a><button type="button" class="timzee-consent-manage" data-consent="manage">Manage choices</button></div>
      <div class="timzee-consent-actions"><button type="button" data-consent="decline">Reject optional</button><button type="button" data-consent="accept">Accept optional cookies</button></div>
    </div>`;
  if (force || !readConsent()) requestAnimationFrame(() => banner.classList.add("is-visible"));
}

export function getCookieConsent() { return readConsent(); }
export function hasOptionalCookieConsent() { return readConsent() === "accepted"; }
if (typeof window !== "undefined") {
  window.openCookieSettings = openCookieSettings;
  window.getCookieConsent = getCookieConsent;
  const init = () => { injectStyles(); renderBanner(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
}
