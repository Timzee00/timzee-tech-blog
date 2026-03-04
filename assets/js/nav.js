import { startPresence } from "./presence.js";
import { supabase, getCurrentUser } from "./supabase.js";
import { fetchUnreadNotificationCount } from "./data.js";
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

  const setOpen = (open) => {
    document.body.classList.toggle("nav-open", open);
    toggle.classList.toggle("active", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };

  toggle.addEventListener("click", () => {
    const next = !document.body.classList.contains("nav-open");
    setOpen(next);
  });

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

setupGlobalErrorHandlers();
setupMobileMenu();
startPresence(window.location.pathname);

let notificationChannel = null;

async function setupNotificationBadge() {
  const user = await getCurrentUser();
  if (!user) return;
  
  // Ensure badge element exists - create it if necessary
  let badge = document.getElementById("notificationCount");
  if (!badge) {
    const authActions = document.getElementById("authActions");
    if (authActions) {
      const notifLink = document.createElement("a");
      notifLink.id = "notificationLink";
      notifLink.className = "btn ghost";
      notifLink.href = "profile.html?tab=notifications";
      notifLink.style.position = "relative";
      
      const bellIcon = document.createElement("span");
      bellIcon.innerHTML = "🔔";
      bellIcon.style.fontSize = "1.2em";
      
      badge = document.createElement("span");
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
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: bold;
        display: none;
      `;
      
      notifLink.appendChild(bellIcon);
      notifLink.appendChild(badge);
      authActions.insertBefore(notifLink, authActions.firstChild);
    }
  }

  const updateCount = async () => {
    try {
      const count = await fetchUnreadNotificationCount(user.id);
      if (badge) {
        badge.textContent = count > 0 ? (count > 99 ? "99+" : count) : "";
        badge.style.display = count > 0 ? "inline-flex" : "none";
      }
    } catch (error) {
      console.error("Failed to update notification count:", error);
    }
  };

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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("Notifications subscribed");
        }
      });
  }
}


async function setupWelcomePrompt() {
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

setupWelcomePrompt();
setupNotificationBadge();
