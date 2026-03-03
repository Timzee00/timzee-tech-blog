import {
  supabase,
  SITE_URL,
  getCurrentUser,
  signIn,
  signUp,
  signOut,
  resetPassword,
  getDisplayName
} from "./supabase.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import { setupReveal } from "./reveal.js";
import { extractErrorMessage, reportAppError } from "./utils.js";
import "./nav.js";

function setMessage(target, message, show = true) {
  if (!target) return;
  target.textContent = message;
  target.style.display = show ? "block" : "none";
}

function getHashParams() {
  const hash = window.location.hash.replace(/^#/, "");
  return new URLSearchParams(hash);
}

function clearHash() {
  if (window.location.hash) {
    history.replaceState({}, document.title, window.location.pathname + window.location.search);
  }
}

function sanitizeUsername(value = "") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");
}

async function ensureUniqueUsername(base, userId) {
  const seed = sanitizeUsername(base) || `member${Math.floor(Math.random() * 99999)}`;
  let candidate = seed;
  let suffix = 1;
  while (true) {
    const existing = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", candidate)
      .neq("id", userId)
      .limit(1)
      .maybeSingle();
    if (!existing.data) break;
    candidate = `${seed}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function ensureProfileRecord(user) {
  if (!user) return;
  const displayName = getDisplayName(user);
  const email = user.email || "";
  const username =
    user.user_metadata?.username ||
    (email ? email.split("@")[0] : displayName.toLowerCase().replace(/\s+/g, ""));
  const safeUsername = await ensureUniqueUsername(username, user.id);
  await supabase
    .from("profiles")
    .upsert({
      id: user.id,
      display_name: displayName,
      username: safeUsername,
      email,
      role: user.user_metadata?.role || "user",
      updated_at: new Date().toISOString()
    })
    .select();
}

async function fetchProfileStatus() {
  const user = await getCurrentUser();
  if (!user) return null;
  const result = await supabase
    .from("profiles")
    .select("account_status")
    .eq("id", user.id)
    .maybeSingle();
  if (result.error) {
    console.warn("Profile status check failed", result.error);
    return null;
  }
  if (result.data?.account_status === "suspended") {
    return {
      blocked: true,
      message: "Account access is currently suspended. Contact support for help."
    };
  }
  return { blocked: false };
}

async function boot() {
  setupReveal();
  const settings = await fetchSettings();
  if (settings.themeId) {
    const theme = await fetchThemeById(settings.themeId);
    if (theme) applyThemeVariables(theme);
  }
  const params = new URLSearchParams(window.location.search);
  const nextUrl = params.get("next") || "index.html";

  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const forgotToggle = document.getElementById("forgotToggle");
  const forgotForm = document.getElementById("forgotForm");
  const switcher = document.querySelector(".auth-switcher");
  const switchButtons = document.querySelectorAll(".auth-switch-btn");
  const loginMessage = document.getElementById("loginMessage");
  const signupMessage = document.getElementById("signupMessage");
  const resetForm = document.getElementById("resetForm");
  const resetMessage = document.getElementById("resetMessage");
  const redirectTo = SITE_URL ? `${SITE_URL}/login.html` : undefined;

  const setView = (view) => {
    if (!switcher) return;
    switcher.dataset.view = view;
    const loginPanel = switcher.querySelector(".auth-panel-login");
    const signupPanel = switcher.querySelector(".auth-panel-signup");
    const resetPanel = switcher.querySelector(".auth-panel-reset");
    if (loginPanel) loginPanel.setAttribute("aria-hidden", view !== "login");
    if (signupPanel) signupPanel.setAttribute("aria-hidden", view !== "signup");
    if (resetPanel) resetPanel.setAttribute("aria-hidden", view !== "reset");
  };

  const hashParams = getHashParams();
  const recoveryType = hashParams.get("type") || "";
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  const isRecovery = recoveryType === "recovery" || recoveryType === "password_recovery";

  let initialView = switcher?.dataset.view || "login";
  if (isRecovery) {
    initialView = "reset";
    if (accessToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error) {
        setMessage(resetMessage, error.message || "Recovery session failed.");
      }
    } else {
      setMessage(resetMessage, "Recovery link invalid or expired. Request a new one.");
    }
    clearHash();
  }

  const user = await getCurrentUser();
  if (user && !isRecovery) {
    setMessage(loginMessage, "You are already logged in. Continue to the site.");
    const continueBtn = document.createElement("a");
    continueBtn.className = "btn";
    continueBtn.href = nextUrl;
    continueBtn.textContent = "Continue";
    loginMessage.appendChild(document.createElement("div"));
    loginMessage.appendChild(continueBtn);
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value.trim();
      const result = await signIn(email, password);
      if (result.error) {
        setMessage(loginMessage, result.error.message);
        return;
      }
      const user = await getCurrentUser();
      await ensureProfileRecord(user);
      const profileCheck = await fetchProfileStatus();
      if (profileCheck?.blocked) {
        setMessage(loginMessage, profileCheck.message || "Account access is restricted.");
        await signOut();
        return;
      }
      window.location.href = nextUrl;
    });
  }

  if (forgotToggle && forgotForm) {
    forgotToggle.addEventListener("click", () => {
      forgotForm.classList.toggle("hidden");
    });
  }

  if (forgotForm) {
    forgotForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = document.getElementById("forgotEmail").value.trim();
      if (!email) return;
      const result = await resetPassword(email, redirectTo);
      if (result.error) {
        setMessage(loginMessage, result.error.message || "Reset request failed.");
        return;
      }
      setMessage(loginMessage, "Reset link sent. Check your email.");
      forgotForm.classList.add("hidden");
      forgotForm.reset();
    });
  }

  if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = document.getElementById("signupName").value.trim();
      const email = document.getElementById("signupEmail").value.trim();
      const password = document.getElementById("signupPassword").value.trim();
      const result = await signUp(email, password, name);
      if (result.error) {
        setMessage(signupMessage, result.error.message);
        return;
      }
      setMessage(signupMessage, "Account created. Check your email if confirmation is required.");
      await signOut();
    });
  }

  if (resetForm) {
    resetForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = document.getElementById("resetPassword").value.trim();
      const confirm = document.getElementById("resetPasswordConfirm").value.trim();
      if (!password || password.length < 6) {
        setMessage(resetMessage, "Password must be at least 6 characters.");
        return;
      }
      if (password !== confirm) {
        setMessage(resetMessage, "Passwords do not match.");
        return;
      }
      const result = await supabase.auth.updateUser({ password });
      if (result.error) {
        setMessage(resetMessage, result.error.message || "Password reset failed.");
        return;
      }
      await signOut();
      resetForm.reset();
      setMessage(loginMessage, "Password updated. Please log in.");
      setView("login");
    });
  }

  if (switchButtons.length) {
    switchButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.switch || "login";
        setView(target);
      });
    });
  }

  if (switcher) {
    setView(initialView);
  }
}

boot().catch((error) => {
  reportAppError(error, "Auth page load failed");
  const message = extractErrorMessage(error, "Unable to load authentication tools.");
  const loginMessage = document.getElementById("loginMessage");
  if (loginMessage) {
    loginMessage.textContent = message;
    loginMessage.style.display = "block";
  }
});
