import { icon } from "./icons.js";
import { extractErrorMessage, reportAppError } from "./utils.js";

function setupGlobalErrorHandlers() {
  if (typeof window === "undefined" || window.__timzeeErrorHandlersReady) return;
  window.__timzeeErrorHandlersReady = true;
  window.addEventListener("error", (event) => {
    const message = event?.error || event?.message || "Unexpected website error.";
    reportAppError(message, "Website error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const message = extractErrorMessage(event?.reason, "Unhandled backend error.");
    reportAppError(message, "Backend error");
  });
}

function setupMobileMenu() {
  const wrap = document.querySelector(".site-header .wrap");
  if (!wrap) return;

  const nav = wrap.querySelector(".nav-pill");
  const actions = wrap.querySelector(".header-actions");
  if (!nav && !actions) return;

  let menu = wrap.querySelector(".site-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.className = "site-menu";
    menu.id = "siteMenu";
    wrap.appendChild(menu);

    const menuHeader = document.createElement("div");
    menuHeader.className = "site-menu-header";
    menuHeader.innerHTML =
      '<span class="site-menu-title"><span class="signal-bar" aria-hidden="true" style="display:inline-flex; height:14px; margin-right:8px; vertical-align:middle;"><span></span><span></span><span></span></span>Menu</span>' +
      '<button type="button" class="site-menu-close" aria-label="Close menu">&times;</button>';
    menu.appendChild(menuHeader);

    if (nav) menu.appendChild(nav);
    if (actions) menu.appendChild(actions);



    const footer = document.createElement("div");
    footer.className = "site-menu-footer";
    footer.id = "siteMenuFooter";
    footer.innerHTML = `
      <div class="site-menu-user" id="siteMenuUser" hidden>
        <img id="siteMenuUserAvatar" alt="">
        <div>
          <div class="site-menu-user-name" id="siteMenuUserName">—</div>
          <div class="site-menu-user-handle" id="siteMenuUserHandle"></div>
        </div>
      </div>
      <div class="site-menu-footer-actions">
        <button type="button" class="chip" id="siteMenuThemeChip">&#127768; Theme</button>
        <a class="chip" href="login.html" id="siteMenuAuthChip">&#128274; Log In</a>
      </div>
    `;
    menu.appendChild(footer);

    const themeChip = footer.querySelector("#siteMenuThemeChip");
    themeChip.addEventListener("click", () => {
      window.appUI.toggleTheme();
    });
  }

  let toggle = wrap.querySelector(".menu-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "menu-toggle";
    toggle.setAttribute("aria-controls", "siteMenu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = "<span class=\"menu-icon\"></span><span>Menu</span>";
    wrap.insertBefore(toggle, menu);
  }

  let backdrop = document.querySelector(".drawer-backdrop-layer");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "drawer-backdrop-layer";
    document.body.appendChild(backdrop);
  }

  const menuHomeParent = wrap;
  const menuHomeNextSibling = menu.nextSibling;

  const setOpen = (open) => {
    // On mobile, move the drawer to be a direct child of <body> while open.
    // Why: .site-header has its own z-index to stay above scrolling page
    // content, which makes it create its own separate stacking context.
    // Since the drawer lived inside that header, its (much higher) z-index
    // was only ever being compared against OTHER things inside the header —
    // not against the body-level backdrop — so the header's low z-index
    // capped it, and the backdrop always won the stacking fight even though
    // the drawer's own number was bigger. Moving it out to body puts it in
    // the same stacking context as the backdrop, where the numbers actually
    // get compared directly and the drawer correctly wins.
    if (open && window.innerWidth <= 960) {
      document.body.appendChild(menu);
    } else if (!open && menu.parentElement === document.body) {
      // Restore it to its original spot once closed, so desktop's inline
      // flex layout (which expects it inside .wrap) is unaffected.
      if (menuHomeNextSibling) {
        menuHomeParent.insertBefore(menu, menuHomeNextSibling);
      } else {
        menuHomeParent.appendChild(menu);
      }
    }
    document.body.classList.toggle("nav-open", open);
    toggle.classList.toggle("active", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (window.innerWidth <= 960) {
      menu.inert = !open;
      menu.setAttribute("role", "dialog");
      menu.setAttribute("aria-label", "Site navigation");
      menu.setAttribute("aria-modal", String(open));
      [...document.body.children].filter(node => node !== menu && node !== backdrop && !node.matches("script, style, dialog")).forEach(node => {
        if (open) { node.dataset.navInert = String(node.inert); node.inert = true; }
        else if (node.hasAttribute("data-nav-inert")) { node.inert = node.dataset.navInert === "true"; delete node.dataset.navInert; }
      });
      if (open) menu.querySelector("button")?.focus(); else toggle.focus();
    } else {
      menu.inert = false; menu.removeAttribute("role"); menu.removeAttribute("aria-modal");
      document.querySelectorAll("[data-nav-inert]").forEach(node => { node.inert = node.dataset.navInert === "true"; delete node.dataset.navInert; });
    }
  };

  menu.inert = window.innerWidth <= 960;
  menu.addEventListener("keydown", event => {
    if (event.key !== "Tab" || !document.body.classList.contains("nav-open")) return;
    const nodes = [...menu.querySelectorAll('a[href], button, input, select, textarea')].filter(el => !el.disabled && el.getClientRects().length);
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  toggle.addEventListener("click", () => {
    const next = !document.body.classList.contains("nav-open");
    setOpen(next);
  });

  backdrop.addEventListener("click", () => setOpen(false));

  const closeBtn = menu.querySelector(".site-menu-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => setOpen(false));
  }

  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      setOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("nav-open")) setOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("nav-open")) return;
    if (event.target.closest(".menu-toggle") || event.target.closest(".site-menu")) return;
    setOpen(false);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 960) setOpen(false);
    else if (!document.body.classList.contains("nav-open")) menu.inert = true;
  });
}

// Marks whichever nav link matches the current page with .active, so every
// page shares the exact same header markup instead of each page hardcoding
// which link is "current" (which is how pages drifted out of sync before).
function setupActiveNavLink() {
  const current = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll(".nav-pill a, .nav-more-menu a").forEach((link) => {
    const href = (link.getAttribute("href") || "").toLowerCase();
    if (!href || href.startsWith("#")) return;
    const hrefPage = href.split("?")[0].split("/").pop();
    if (hrefPage === current || (current === "index.html" && hrefPage === "")) {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
      if (link.closest(".nav-more")) {
        const toggle = link.closest(".nav-more").querySelector(".nav-more-toggle");
        if (toggle) toggle.classList.add("active-parent");
      }
    }
  });
}

// Desktop "More" dropdown: click to toggle, close on outside click/Escape.
// On mobile this toggle is hidden by CSS and the menu renders inline instead.
function setupMoreDropdown() {
  document.querySelectorAll(".nav-more").forEach((wrap) => {
    const toggle = wrap.querySelector(".nav-more-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = wrap.classList.contains("open");
      document.querySelectorAll(".nav-more.open").forEach((el) => { el.classList.remove("open"); el.querySelector("button")?.setAttribute("aria-expanded", "false"); });
      wrap.classList.toggle("open", !isOpen);
      toggle.setAttribute("aria-expanded", (!isOpen).toString());
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".nav-more.open").forEach((el) => { el.classList.remove("open"); el.querySelector("button")?.setAttribute("aria-expanded", "false"); });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".nav-more.open").forEach((el) => { el.classList.remove("open"); el.querySelector("button")?.setAttribute("aria-expanded", "false"); });
    }
  });
}

setupGlobalErrorHandlers();
setupMobileMenu();
document.querySelectorAll(".header-actions .icon-btn").forEach(link => {
  const name = new URL(link.href).pathname.split("/").pop().replace(".html", "");
  link.innerHTML = icon(name);
});
setupActiveNavLink();
setupMoreDropdown();
setupBottomTabBar(false);
// Workspace routes need the actual chrome height, including wrapped tablet
// navigation and the safe-area inset, to keep their composer on screen.
const chromeObserver = new ResizeObserver(() => {
  for (const [selector, name] of [[".site-header", "--site-header-height"], [".bottom-tab-bar", "--bottom-nav-height"]]) {
    const height = document.querySelector(selector)?.getBoundingClientRect().height || 0;
    document.documentElement.style.setProperty(name, `${height}px`);
  }
});
document.querySelectorAll(".site-header, .bottom-tab-bar").forEach(element => chromeObserver.observe(element));

// Everything below this line depends on the Supabase client, which is
// bundled locally inside supabase.js. That dependency previously sat at the TOP of this file as a static
// import — and a static import failure (CDN blocked, slow, or down)
// silently fails this entire module's execution, taking the menu code
// above down with it even though the menu itself needs no network access
// at all. Loading it dynamically here instead means a failure here is just
// a caught promise rejection: the menu (and everything else already run
// above) is completely unaffected either way.
(async () => {
  try {
    const [{ startPresence }, { supabase, getCurrentUser, signOut }, { fetchUnreadNotificationCount }, { fetchSettings }] =
      await Promise.all([
        import("./presence.js"),
        import("./supabase.js"),
        import("./data.js"),
        import("./settings.js")
      ]);

    startPresence(window.location.pathname);
    await setupNotificationBadge(supabase, getCurrentUser, fetchUnreadNotificationCount);
    const settings = await fetchSettings();
    applySiteBranding(settings);
    const user = await getCurrentUser();
    setupBottomTabBar(!!user);
    populateDrawerFooter(user, signOut);
  } catch (error) {
    console.error("Supabase-dependent nav features failed to load (menu is unaffected):", error);
  }
})();

function populateDrawerFooter(user, signOut) {
  const userCard = document.getElementById("siteMenuUser");
  const authChip = document.getElementById("siteMenuAuthChip");
  if (!userCard || !authChip) return;

  if (!user) {
    userCard.hidden = true;
    authChip.textContent = "";
    authChip.innerHTML = "&#128274; Log In";
    authChip.setAttribute("href", "/login.html");
    return;
  }

  userCard.hidden = false;
  const name = user.user_metadata?.display_name || user.email || "Member";
  const avatarUrl =
    user.user_metadata?.avatar_url ||
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80";
  document.getElementById("siteMenuUserAvatar").src = avatarUrl;
  document.getElementById("siteMenuUserName").textContent = name;
  document.getElementById("siteMenuUserHandle").textContent = user.email || "";

  authChip.textContent = "";
  authChip.innerHTML = "&#128682; Sign Out";
  authChip.setAttribute("href", "#");
  authChip.addEventListener("click", async (event) => {
    event.preventDefault();
    await signOut();
    window.location.href = "index.html";
  });
}

// Persistent mobile bottom tab bar (Home / Search / Create / Chat /
// Profile) — the structural piece from the reference design. Desktop is
// unaffected (hidden via CSS above 960px); the existing hamburger drawer
// stays exactly as-is alongside this, it isn't replaced.
function setupBottomTabBar(isLoggedIn) {
  if (!document.querySelector(".site-header")) return;
  document.getElementById("bottomTabBar")?.remove();
  const path = window.location.pathname.split("/").pop() || "index.html";

  const tabs = [
    { href: "index.html", icon: "&#127968;", label: "Home", match: ["index.html", ""] },
    { href: "discussion.html", icon: "&#128172;", label: "Discuss", match: ["discussion.html"] },
    { href: "marketplace.html", icon: "&#128722;", label: "Market", match: ["marketplace.html", "listing.html"] },
    { href: "chat.html", icon: "&#128172;", label: "Chat", match: ["chat.html"] },
    {
      href: isLoggedIn ? "profile.html" : "login.html",
      icon: "&#128100;",
      label: isLoggedIn ? "Profile" : "Log In",
      match: ["profile.html"]
    }
  ];

  const bar = document.createElement("nav");
  bar.id = "bottomTabBar";
  bar.className = "bottom-tab-bar";
  bar.setAttribute("aria-label", "Primary");
  bar.innerHTML = tabs
    .map((tab) => {
      const active = tab.match.includes(path);
      const classes = ["bottom-tab"];
      if (active) classes.push("active");
      if (tab.isCreate) classes.push("bottom-tab-create");
      return `<a class="${classes.join(" ")}" href="/${tab.href}" aria-label="${tab.label}" ${active ? 'aria-current="page"' : ""}>
        <span class="bottom-tab-icon">${icon(tab.href.replace(".html", "").replace("index", "home").replace("login", "profile"))}</span>
        <span class="bottom-tab-label">${tab.label}</span>
      </a>`;
    })
    .join("");

  document.body.appendChild(bar);
}

// Applies the admin-configurable site name/tagline everywhere the OLD
// hardcoded "Timzee Tech Hub" text used to live, so renaming the site (e.g.
// before buying a new domain) is a single settings-panel edit instead of a
// code change across 19+ pages. Falls back to leaving the original static
// text alone if settings somehow fail to load.
function applySiteBranding(settings) {
  if (!settings || !settings.siteName) return;

  const logoEl = document.getElementById("siteName");
  if (logoEl) {
    // Preserve the "<first word> <span>rest</span>" split styling only when
    // the name still has 2+ words; otherwise just show the plain name.
    const parts = settings.siteName.trim().split(/\s+/);
    if (parts.length > 1) {
      const first = parts[0];
      const rest = parts.slice(1).join(" ");
      logoEl.innerHTML = `${escapeForBranding(first)} <span>${escapeForBranding(rest)}</span>`;
    } else {
      logoEl.textContent = settings.siteName;
    }
  }

  const taglineEl = document.getElementById("siteTagline");
  if (taglineEl && settings.tagline) {
    taglineEl.textContent = settings.tagline;
  }

  if (document.title.includes("Timzee Tech Hub")) {
    document.title = document.title.replace(/Timzee Tech Hub/g, settings.siteName);
  }
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) ogSiteName.setAttribute("content", settings.siteName);
}

function escapeForBranding(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

let notificationChannel = null;

async function setupNotificationBadge(supabase, getCurrentUser, fetchUnreadNotificationCount) {
  const user = await getCurrentUser();
  if (!user) return;

  const ensureBadge = () => {
    const authActions = document.getElementById("authActions");
    if (!authActions) return null;

    let notifLink = document.getElementById("notificationLink");
    if (!notifLink) {
      notifLink = document.createElement("a");
      notifLink.id = "notificationLink";
      notifLink.className = "btn ghost";
      notifLink.setAttribute("aria-label", "Notifications");
      notifLink.href = "/profile.html?tab=notifications";
      notifLink.style.position = "relative";

      const bellIcon = document.createElement("span");
      bellIcon.innerHTML = icon("bell");
      bellIcon.style.fontSize = "1.2em";

      const badge = document.createElement("span");
      badge.id = "notificationCount";
      badge.className = "notif-count";
      badge.style.cssText = `
        position: absolute;
        top: -8px;
        right: -8px;
        background: #ef4444;
        color: white;
        border-radius: 50%;
        width: 20px;
        height: 20px;
        display: none;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: bold;
      `;

      notifLink.appendChild(bellIcon);
      notifLink.appendChild(badge);
      authActions.insertBefore(notifLink, authActions.firstChild);
    }
    return document.getElementById("notificationCount");
  };

  // Every page has its own copy of renderAuthActions() that rebuilds
  // #authActions from scratch after this function's initial (lightweight)
  // getCurrentUser() call resolves — which reliably wins the race against
  // the page's own boot() sequence, since that sequence usually awaits
  // several more data fetches first. Rebuilding wipes whatever this
  // function just inserted, which is why the notification count previously
  // showed up blank/stuck. Watching #authActions and re-inserting the
  // badge whenever it's removed makes this self-healing regardless of
  // load-order timing, instead of depending on winning a one-shot race.
  let lastCount = 0;
  const updateCount = async () => {
    try {
      const count = await fetchUnreadNotificationCount(user.id);
      lastCount = count;
      const badge = ensureBadge();
      if (badge) {
        badge.textContent = count > 0 ? (count > 99 ? "99+" : count) : "";
        badge.style.display = count > 0 ? "inline-flex" : "none";
      }
    } catch (error) {
      console.error("Failed to update notification count:", error);
    }
  };

  const authActionsParent = document.querySelector(".header-actions") || document.body;
  const observer = new MutationObserver(() => {
    const badge = ensureBadge();
    if (badge && !badge.textContent && lastCount > 0) {
      badge.textContent = lastCount > 99 ? "99+" : lastCount;
      badge.style.display = "inline-flex";
    }
  });
  observer.observe(authActionsParent, { childList: true, subtree: true });

  await updateCount();

  if (!notificationChannel) {
    notificationChannel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`
        },
        updateCount
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`
        },
        updateCount
      )
      .subscribe();
  }
}
