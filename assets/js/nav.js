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
      '<span class="site-menu-title">Menu</span>' +
      '<button type="button" class="site-menu-close" aria-label="Close menu">&times;</button>';
    menu.appendChild(menuHeader);

    if (nav) menu.appendChild(nav);
    if (actions) menu.appendChild(actions);
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
  };

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
    if (event.key === "Escape") setOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("nav-open")) return;
    if (event.target.closest(".menu-toggle") || event.target.closest(".site-menu")) return;
    setOpen(false);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 960) setOpen(false);
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
      document.querySelectorAll(".nav-more.open").forEach((el) => el.classList.remove("open"));
      wrap.classList.toggle("open", !isOpen);
      toggle.setAttribute("aria-expanded", (!isOpen).toString());
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".nav-more.open").forEach((el) => el.classList.remove("open"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".nav-more.open").forEach((el) => el.classList.remove("open"));
    }
  });
}

setupGlobalErrorHandlers();
setupMobileMenu();
setupActiveNavLink();
setupMoreDropdown();

// Everything below this line depends on the Supabase client, which is
// loaded from an external CDN inside supabase.js. That single external
// network dependency previously sat at the TOP of this file as a static
// import — and a static import failure (CDN blocked, slow, or down)
// silently fails this entire module's execution, taking the menu code
// above down with it even though the menu itself needs no network access
// at all. Loading it dynamically here instead means a failure here is just
// a caught promise rejection: the menu (and everything else already run
// above) is completely unaffected either way.
(async () => {
  try {
    const [{ startPresence }, { supabase, getCurrentUser }, { fetchUnreadNotificationCount }] =
      await Promise.all([import("./presence.js"), import("./supabase.js"), import("./data.js")]);

    startPresence(window.location.pathname);
    await setupNotificationBadge(supabase, getCurrentUser, fetchUnreadNotificationCount);
    await setupWelcomePrompt(getCurrentUser);
  } catch (error) {
    console.error("Supabase-dependent nav features failed to load (menu is unaffected):", error);
  }
})();

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
      notifLink.href = "profile.html?tab=notifications";
      notifLink.style.position = "relative";

      const bellIcon = document.createElement("span");
      bellIcon.innerHTML = "🔔";
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


async function setupWelcomePrompt(getCurrentUser) {
  const path = window.location.pathname || "";
  if (
    path.includes("login") ||
    path.includes("admin") ||
    path.includes("super") ||
    document.body.classList.contains("admin-shell")
  ) {
    return;
  }
  let dismissed = false;
  try {
    dismissed = localStorage.getItem("welcome_prompt_seen") === "true";
  } catch (error) {
    dismissed = false;
  }
  if (dismissed) return;
  const user = await getCurrentUser();
  if (user) return;

  const overlay = document.createElement("div");
  overlay.className = "welcome-modal";
  overlay.innerHTML = `
    <div class="welcome-card">
      <span class="chip">Welcome</span>
      <h2>Join Timzee Tech Hub</h2>
      <p>Sign up to follow creators, save posts, and join discussions.</p>
      <div class="welcome-actions">
        <a class="btn" href="login.html?view=signup">Create account</a>
        <a class="btn ghost" href="login.html">Sign in</a>
      </div>
      <button class="btn ghost welcome-close" type="button">Maybe later</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = overlay.querySelector(".welcome-close");
  const dismiss = () => {
    overlay.remove();
    try {
      localStorage.setItem("welcome_prompt_seen", "true");
    } catch (error) {
      // Ignore storage failures.
    }
  };
  if (close) {
    close.addEventListener("click", dismiss);
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dismiss();
  });
}
