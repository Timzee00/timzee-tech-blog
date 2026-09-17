import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
import "./app-hardening.js";

const SUPABASE_URL = "https://duvbcwwprkzzyzikmcol.supabase.co";
// Publishable key: safe for browser clients. Never put the service/secret key here.
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_otXKj1pYtPToX6Dp4oq19g_Aid-WkkC";
export const SITE_URL = "https://timzee-tech-blog.netlify.app";

const PROFILE_PUBLIC_COLUMNS = [
  "id", "display_name", "username", "avatar_url", "cover_url", "bio", "headline",
  "location", "website", "role", "is_verified", "is_featured", "is_staff_pick",
  "verification_tier", "verified_at", "points", "level", "created_at",
  "allow_messages", "allow_requests", "show_email"
].join(",");

const PROFILE_SELF_COLUMNS = `${PROFILE_PUBLIC_COLUMNS},email,notify_messages,notify_replies,notify_follows,notify_mentions`;
const MARKETPLACE_PUBLIC_COLUMNS = [
  "id", "user_id", "seller_name", "title", "description", "category", "subcategory",
  "price", "currency", "condition", "location", "images", "is_available", "view_count",
  "created_at", "updated_at", "expires_at"
].join(",");

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: "pkce"
  }
});

// The legacy app still contains a few `select("*")` calls. Constrain those
// requests centrally so a missed call site cannot accidentally fetch private
// profile fields or internal marketplace metadata. Explicit column lists are
// never changed by this guard.
const originalFrom = supabase.from.bind(supabase);
supabase.from = (table) => {
  const builder = originalFrom(table);
  const originalSelect = builder.select.bind(builder);

  builder.select = (columns = "*", ...rest) => {
    const requested = String(columns || "*").trim();
    if (requested !== "*") return originalSelect(columns, ...rest);

    const pathname = typeof window === "undefined" ? "" : window.location.pathname;
    const internalAdminArea = /^\/(?:admin|moderator|super)\//i.test(pathname);
    const profilePage = /\/profile\.html$/i.test(pathname);
    const profileId = typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("id") || "";
    const currentUserId = typeof window === "undefined" ? "" : window.__timzeeCurrentUserId || "";

    if (table === "profiles") {
      if (internalAdminArea) return originalSelect(columns, ...rest);
      if (profilePage && (!profileId || (currentUserId && profileId === currentUserId))) {
        return originalSelect(PROFILE_SELF_COLUMNS, ...rest);
      }
      return originalSelect(PROFILE_PUBLIC_COLUMNS, ...rest);
    }

    if (table === "marketplace_items") {
      return originalSelect(MARKETPLACE_PUBLIC_COLUMNS, ...rest);
    }

    return originalSelect(columns, ...rest);
  };

  return builder;
};

if (typeof window !== "undefined" && !window.supabase) {
  window.supabase = supabase;
}

// Load the global notification UI after the shared client exists. The UI only
// runs for an authenticated user and degrades harmlessly on anonymous pages.
if (typeof window !== "undefined") {
  import("./notifications-ui.js").catch((error) => {
    console.warn("Realtime notification UI failed to load:", error);
  });
}

const authCallbackPromise = (() => {
  if (typeof window === "undefined") return Promise.resolve(null);
  const code = new URLSearchParams(window.location.search).get("code");
  if (!code) return Promise.resolve(null);

  return supabase.auth.exchangeCodeForSession(code).then((result) => {
    if (result.error) {
      console.error("OAuth code exchange failed:", result.error);
      return result;
    }

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("code");
    history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    return result;
  }).catch((error) => {
    console.error("OAuth callback exchange failed:", error);
    return { data: null, error };
  });
})();

export async function getSession() {
  await authCallbackPromise;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("Session fetch failed", error);
    return null;
  }
  return data.session;
}

export async function exchangeOAuthCode(code) {
  if (!code) return { data: null, error: null };
  try {
    return await supabase.auth.exchangeCodeForSession(code);
  } catch (error) {
    console.error("OAuth code exchange failed:", error);
    return {
      data: null,
      error: {
        message: error?.message || "OAuth session exchange failed.",
        status: error?.status
      }
    };
  }
}

async function resolveTrustedRole(user) {
  if (!user) return null;

  let role = user.app_metadata?.role || null;

  if (!role) {
    try {
      const profileResult = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profileResult.error) {
        console.warn("Failed to fetch trusted profile role:", profileResult.error);
      } else if (profileResult.data?.role) {
        role = profileResult.data.role;
      }
    } catch (err) {
      console.warn("Failed to fetch role from profiles:", err);
    }
  }

  if (!role) {
    try {
      const roleResult = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!roleResult.error && roleResult.data?.role) {
        role = roleResult.data.role;
      }
    } catch (err) {
      console.warn("Failed to fetch role mapping:", err);
    }
  }

  if (role) {
    // Authorization continues to use app_metadata / DB-backed role state.
    // This non-enumerable property exists only in memory for a few legacy UI
    // components that still read user_metadata.role; it is never persisted.
    user.app_metadata = { ...(user.app_metadata || {}), role };
    try {
      if (!user.user_metadata) user.user_metadata = {};
      Object.defineProperty(user.user_metadata, "role", {
        value: role,
        writable: true,
        configurable: true,
        enumerable: false
      });
    } catch (err) {
      console.warn("Could not expose trusted role to legacy UI in memory:", err);
    }
  }

  return role;
}

export async function getCurrentUser() {
  await authCallbackPromise;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.warn("User fetch failed", error);
    return null;
  }
  const user = data.user;
  if (!user) return null;
  if (typeof window !== "undefined") window.__timzeeCurrentUserId = user.id;
  await resolveTrustedRole(user);
  return user;
}

export async function signIn(email, password) {
  try {
    return await supabase.auth.signInWithPassword({ email, password });
  } catch (error) {
    console.error("SignIn network error:", error);
    return {
      error: {
        message: `Network error: ${error.message}. Check your internet connection and Supabase URL.`,
        status: error.status
      }
    };
  }
}

export async function signInWithProvider(provider, redirectTo) {
  try {
    return await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectTo || `${SITE_URL}/login.html`
      }
    });
  } catch (error) {
    console.error(`${provider} OAuth network error:`, error);
    return {
      error: {
        message: `Network error: ${error.message}. Check your internet connection and Supabase URL.`,
        status: error.status
      }
    };
  }
}

export async function signUp(email, password, displayName = "") {
  const fallbackUsername = email ? email.split("@")[0] : "";
  try {
    return await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
          username: displayName ? displayName.toLowerCase().replace(/\s+/g, "") : fallbackUsername
        },
        emailRedirectTo: SITE_URL ? `${SITE_URL}/login.html` : undefined
      }
    });
  } catch (error) {
    console.error("SignUp network error:", error);
    return {
      error: {
        message: `Network error: ${error.message}. Check your internet connection and Supabase URL.`,
        status: error.status
      }
    };
  }
}

export async function signOut() {
  if (typeof window !== "undefined") delete window.__timzeeCurrentUserId;
  return supabase.auth.signOut();
}

export async function getCurrentUserWithRole() {
  return getCurrentUser();
}

export function getUserRole(user) {
  return user?.app_metadata?.role || "user";
}

export function getDisplayName(user) {
  const fromMeta =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name;
  if (fromMeta) return fromMeta;
  if (user?.email) return user.email.split("@")[0];
  return "Member";
}

export function hasRole(user, roles = []) {
  if (!user) return false;
  return roles.includes(getUserRole(user));
}

export async function resetPassword(email, redirectTo) {
  if (!email) return { error: { message: "Email is required." } };
  const target = redirectTo || (SITE_URL ? `${SITE_URL}/login.html` : "");
  const options = target ? { redirectTo: target } : undefined;
  return supabase.auth.resetPasswordForEmail(email, options);
}
