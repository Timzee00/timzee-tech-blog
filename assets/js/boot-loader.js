/* Cinematic site-wide loader for Timzee Tech Hub. No external assets. */
(function initTimzeeBootLoader() {
  if (typeof window === "undefined" || window.__timzeeBootLoaderReady) return;
  window.__timzeeBootLoaderReady = true;

  const STYLE_ID = "timzee-boot-loader-style";
  const LOADER_ID = "timzeeBootLoader";
  const MIN_SHOW_MS = 650;
  const MAX_SHOW_MS = 7000;
  const NAV_SHOW_MS = 900;
  const bootStartedAt = performance.now();
  let hideTimer = 0;
  let maxTimer = 0;
  let progressTimer = 0;
  let navigating = false;

  const styleText = `
    #${LOADER_ID} {
      --tz-loader-ink: #f5f7fa;
      --tz-loader-muted: rgba(245,247,250,.58);
      --tz-loader-line: rgba(245,247,250,.13);
      --tz-loader-glow: rgba(255,255,255,.75);
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: grid;
      place-items: center;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% 44%, rgba(255,255,255,.07), transparent 28%),
        radial-gradient(circle at 50% 50%, rgba(255,255,255,.025), transparent 55%),
        #07090c;
      color: var(--tz-loader-ink);
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      isolation: isolate;
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition: opacity .42s cubic-bezier(.22,1,.36,1), visibility .42s step-end;
    }
    #${LOADER_ID}[hidden] {
      display: grid;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity .42s cubic-bezier(.22,1,.36,1), visibility 0s linear .42s;
    }
    #${LOADER_ID} .tz-loader-grid {
      position: absolute;
      inset: -20%;
      opacity: .34;
      background-image:
        linear-gradient(var(--tz-loader-line) 1px, transparent 1px),
        linear-gradient(90deg, var(--tz-loader-line) 1px, transparent 1px);
      background-size: 46px 46px;
      transform: perspective(650px) rotateX(66deg) translateY(21%);
      transform-origin: center bottom;
      mask-image: linear-gradient(to top, #000, transparent 74%);
      animation: tzGridDrift 12s linear infinite;
    }
    #${LOADER_ID} .tz-loader-scan {
      position: absolute;
      inset: 0;
      background: linear-gradient(to bottom, transparent 0%, rgba(255,255,255,.05) 47%, transparent 53%);
      transform: translateY(-100%);
      animation: tzScan 2.8s linear infinite;
      pointer-events: none;
    }
    #${LOADER_ID} .tz-loader-noise {
      position: absolute;
      inset: 0;
      opacity: .08;
      background-image: radial-gradient(rgba(255,255,255,.7) .5px, transparent .7px);
      background-size: 4px 4px;
      mix-blend-mode: screen;
      pointer-events: none;
    }
    #${LOADER_ID} .tz-loader-core {
      position: relative;
      width: min(520px, 88vw);
      display: grid;
      justify-items: center;
      gap: 24px;
      text-align: center;
      animation: tzCoreIn .7s cubic-bezier(.22,1,.36,1) both;
    }
    #${LOADER_ID} .tz-loader-mark {
      position: relative;
      width: 170px;
      height: 170px;
      display: grid;
      place-items: center;
      filter: drop-shadow(0 0 28px rgba(255,255,255,.12));
    }
    #${LOADER_ID} .tz-loader-ring,
    #${LOADER_ID} .tz-loader-ring::before,
    #${LOADER_ID} .tz-loader-ring::after {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      content: "";
    }
    #${LOADER_ID} .tz-loader-ring {
      border: 1px solid rgba(255,255,255,.19);
      box-shadow: inset 0 0 35px rgba(255,255,255,.03), 0 0 35px rgba(255,255,255,.04);
      animation: tzSpin 5.4s linear infinite;
    }
    #${LOADER_ID} .tz-loader-ring::before {
      inset: 11px;
      border: 1px dashed rgba(255,255,255,.18);
      animation: tzSpinReverse 7.5s linear infinite;
    }
    #${LOADER_ID} .tz-loader-ring::after {
      inset: 25px;
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: inset 0 0 24px rgba(255,255,255,.05);
      animation: tzPulse 1.8s ease-in-out infinite;
    }
    #${LOADER_ID} .tz-loader-sweep {
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      background: conic-gradient(from 0deg, transparent 0 70%, var(--tz-loader-glow) 76%, transparent 83% 100%);
      -webkit-mask: radial-gradient(circle, transparent 0 70px, #000 71px 84px, transparent 85px);
      mask: radial-gradient(circle, transparent 0 70px, #000 71px 84px, transparent 85px);
      animation: tzSpin 2.2s linear infinite;
      opacity: .78;
    }
    #${LOADER_ID} .tz-loader-corners {
      position: absolute;
      inset: 39px;
      border: 1px solid rgba(255,255,255,.16);
      clip-path: polygon(0 0, 22% 0, 22% 2px, 2px 2px, 2px 22%, 0 22%, 0 0, 100% 0, 100% 22%, calc(100% - 2px) 22%, calc(100% - 2px) 2px, 78% 2px, 78% 0, 100% 0, 100% 100%, 78% 100%, 78% calc(100% - 2px), calc(100% - 2px) calc(100% - 2px), calc(100% - 2px) 78%, 100% 78%, 100% 100%, 0 100%, 0 78%, 2px 78%, 2px calc(100% - 2px), 22% calc(100% - 2px), 22% 100%, 0 100%);
      opacity: .56;
      animation: tzCornerPulse 2.2s ease-in-out infinite;
    }
    #${LOADER_ID} .tz-loader-monogram {
      position: relative;
      z-index: 2;
      font: 700 56px/1 "Space Grotesk", Inter, system-ui, sans-serif;
      letter-spacing: -.08em;
      transform: translateX(-3px);
      text-shadow: 0 0 24px rgba(255,255,255,.16);
    }
    #${LOADER_ID} .tz-loader-dot {
      position: absolute;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 12px #fff, 0 0 34px rgba(255,255,255,.5);
      animation: tzOrbit 2.2s linear infinite;
    }
    #${LOADER_ID} .tz-loader-brand {
      display: grid;
      gap: 7px;
      justify-items: center;
      text-transform: uppercase;
    }
    #${LOADER_ID} .tz-loader-title {
      font: 700 clamp(18px, 3vw, 27px)/1 "Space Grotesk", Inter, system-ui, sans-serif;
      letter-spacing: .19em;
      margin-left: .19em;
    }
    #${LOADER_ID} .tz-loader-subtitle {
      color: var(--tz-loader-muted);
      font-size: 10px;
      letter-spacing: .28em;
      margin-left: .28em;
    }
    #${LOADER_ID} .tz-loader-status {
      width: min(460px, 82vw);
      display: grid;
      gap: 11px;
      text-align: left;
    }
    #${LOADER_ID} .tz-loader-status-row {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      color: var(--tz-loader-muted);
      font: 600 10px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: .17em;
      text-transform: uppercase;
    }
    #${LOADER_ID} .tz-loader-status-row strong {
      color: var(--tz-loader-ink);
      font-weight: 600;
    }
    #${LOADER_ID} .tz-loader-track {
      position: relative;
      height: 3px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255,255,255,.1);
      box-shadow: 0 0 0 1px rgba(255,255,255,.04);
    }
    #${LOADER_ID} .tz-loader-progress {
      width: 8%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, rgba(255,255,255,.28), #fff);
      box-shadow: 0 0 12px rgba(255,255,255,.42);
      transform-origin: left center;
      transition: width .18s ease-out;
    }
    #${LOADER_ID} .tz-loader-rail {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 5px;
    }
    #${LOADER_ID} .tz-loader-rail i {
      height: 2px;
      border-radius: 99px;
      background: rgba(255,255,255,.1);
      animation: tzRail 1.2s ease-in-out infinite;
    }
    #${LOADER_ID} .tz-loader-rail i:nth-child(2n) { animation-delay: .09s; }
    #${LOADER_ID} .tz-loader-rail i:nth-child(3n) { animation-delay: .18s; }
    #${LOADER_ID} .tz-loader-rail i:nth-child(4n) { animation-delay: .27s; }
    #${LOADER_ID} .tz-loader-foot {
      color: rgba(255,255,255,.33);
      font: 500 9px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: .17em;
      text-transform: uppercase;
    }
    #${LOADER_ID} .tz-loader-access {
      position: absolute;
      left: 24px;
      bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: rgba(255,255,255,.34);
      font: 600 9px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    #${LOADER_ID} .tz-loader-access::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 10px rgba(255,255,255,.65);
      opacity: .7;
    }
    @keyframes tzSpin { to { transform: rotate(360deg); } }
    @keyframes tzSpinReverse { to { transform: rotate(-360deg); } }
    @keyframes tzPulse { 0%,100% { transform: scale(.96); opacity:.55; } 50% { transform: scale(1.02); opacity:.95; } }
    @keyframes tzOrbit { from { transform: rotate(0deg) translateX(79px) rotate(0deg); } to { transform: rotate(360deg) translateX(79px) rotate(-360deg); } }
    @keyframes tzCornerPulse { 0%,100% { opacity:.28; } 50% { opacity:.72; } }
    @keyframes tzCoreIn { from { opacity:0; transform: translateY(12px) scale(.985); } to { opacity:1; transform: translateY(0) scale(1); } }
    @keyframes tzGridDrift { from { background-position: 0 0; } to { background-position: 0 184px; } }
    @keyframes tzScan { to { transform: translateY(100%); } }
    @keyframes tzRail { 0%,100% { transform: scaleX(.7); opacity:.3; } 50% { transform: scaleX(1); opacity:.95; } }
    @media (max-width: 640px) {
      #${LOADER_ID} .tz-loader-mark { width: 142px; height: 142px; }
      #${LOADER_ID} .tz-loader-monogram { font-size: 48px; }
      #${LOADER_ID} .tz-loader-track { height: 2px; }
      #${LOADER_ID} .tz-loader-access { left: 16px; bottom: 14px; }
    }
    @media (prefers-reduced-motion: reduce) {
      #${LOADER_ID} *, #${LOADER_ID} *::before, #${LOADER_ID} *::after {
        animation-duration: .001ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
      }
    }
  `;

  const statusMessages = [
    "Booting interface",
    "Syncing experience",
    "Loading workspace",
    "Preparing realtime layer",
    "Finalizing interface"
  ];

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = styleText;
    (document.head || document.documentElement).appendChild(style);
  }

  function loaderMarkup() {
    const rail = Array.from({ length: 12 }, () => "<i aria-hidden=\"true\"></i>").join("");
    return `
      <div class="tz-loader-grid" aria-hidden="true"></div>
      <div class="tz-loader-scan" aria-hidden="true"></div>
      <div class="tz-loader-noise" aria-hidden="true"></div>
      <section class="tz-loader-core" role="status" aria-live="polite" aria-label="Loading Timzee Tech Hub">
        <div class="tz-loader-mark" aria-hidden="true">
          <div class="tz-loader-ring"></div>
          <div class="tz-loader-sweep"></div>
          <div class="tz-loader-corners"></div>
          <div class="tz-loader-monogram">TZ</div>
          <span class="tz-loader-dot"></span>
        </div>
        <div class="tz-loader-brand">
          <div class="tz-loader-title">TIMZEE TECH HUB</div>
          <div class="tz-loader-subtitle">Powered by Timzee Corp</div>
        </div>
        <div class="tz-loader-status">
          <div class="tz-loader-status-row">
            <span id="tzLoaderStatus">Booting interface</span>
            <strong id="tzLoaderPercent">08%</strong>
          </div>
          <div class="tz-loader-track"><div class="tz-loader-progress" id="tzLoaderProgress"></div></div>
          <div class="tz-loader-rail" aria-hidden="true">${rail}</div>
        </div>
        <div class="tz-loader-foot">secure client initialization // realtime ready</div>
      </section>
      <div class="tz-loader-access">SYSTEM ONLINE</div>
    `;
  }

  function ensureLoader() {
    injectStyle();
    let loader = document.getElementById(LOADER_ID);
    if (loader) return loader;
    loader = document.createElement("div");
    loader.id = LOADER_ID;
    loader.setAttribute("aria-hidden", "false");
    loader.innerHTML = loaderMarkup();
    const mount = document.body || document.documentElement;
    mount.appendChild(loader);
    return loader;
  }

  function setProgress(percent, statusIndex = null) {
    const progress = document.getElementById("tzLoaderProgress");
    const number = document.getElementById("tzLoaderPercent");
    if (progress) progress.style.width = `${Math.max(8, Math.min(96, percent))}%`;
    if (number) number.textContent = `${String(Math.round(percent)).padStart(2, "0")}%`;
    if (statusIndex !== null) {
      const status = document.getElementById("tzLoaderStatus");
      if (status) status.textContent = statusMessages[Math.max(0, Math.min(statusMessages.length - 1, statusIndex))];
    }
  }

  function showLoader({ navigation = false } = {}) {
    const loader = ensureLoader();
    loader.removeAttribute("hidden");
    loader.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("timzee-loader-active");
    navigating = Boolean(navigation);
    if (!progressTimer) {
      let value = navigation ? 12 : 8;
      progressTimer = window.setInterval(() => {
        const ceiling = navigation ? 74 : 91;
        const next = Math.min(ceiling, value + Math.max(1, (ceiling - value) * 0.08));
        value = next;
        setProgress(value, Math.floor(((value - 8) / 83) * (statusMessages.length - 1)));
      }, 120);
    }
  }

  function hideLoader(force = false) {
    const loader = document.getElementById(LOADER_ID);
    if (!loader) return;
    const elapsed = performance.now() - bootStartedAt;
    const wait = force ? 0 : Math.max(0, MIN_SHOW_MS - elapsed);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      window.clearInterval(progressTimer);
      progressTimer = 0;
      setProgress(100, statusMessages.length - 1);
      loader.setAttribute("aria-hidden", "true");
      loader.setAttribute("hidden", "true");
      document.documentElement.classList.remove("timzee-loader-active");
      navigating = false;
    }, wait);
  }

  function isInternalNavigationLink(link) {
    if (!link || link.tagName !== "A") return false;
    if (link.target && link.target !== "_self") return false;
    if (link.hasAttribute("download")) return false;
    const raw = link.getAttribute("href") || "";
    if (!raw || raw.startsWith("#") || /^(?:mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return false;
    try {
      const target = new URL(raw, window.location.href);
      return target.origin === window.location.origin &&
        (target.pathname !== window.location.pathname || target.search !== window.location.search);
    } catch (_) {
      return false;
    }
  }

  function installNavigationLoader() {
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.("a");
      if (!isInternalNavigationLink(link)) return;
      showLoader({ navigation: true });
      window.setTimeout(() => {
        if (document.visibilityState === "visible" && navigating) hideLoader(true);
      }, MAX_SHOW_MS);
    }, true);
  }

  function installPageLifecycle() {
    window.addEventListener("load", () => hideLoader());
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) hideLoader(true);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigating && performance.now() - bootStartedAt > MAX_SHOW_MS) hideLoader(true);
    });
    window.addEventListener("error", () => {
      window.setTimeout(() => hideLoader(true), 1200);
    }, true);
  }

  function boot() {
    showLoader();
    installNavigationLoader();
    installPageLifecycle();
    maxTimer = window.setTimeout(() => hideLoader(true), MAX_SHOW_MS);
  }

  function mount() {
    if (document.body) boot();
    else window.setTimeout(mount, 0);
  }

  mount();
})();
