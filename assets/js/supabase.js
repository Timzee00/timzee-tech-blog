import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://duvbcwwprkzzyzikmcol.supabase.co";
// Publishable key: safe for browser clients. Never put the service/secret key here.
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_otXKj1pYtPToX6Dp4oq19g_Aid-WkkC";
export const SITE_URL = "https://timzee-tech-blog.netlify.app";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: "pkce"
  }
});

if (typeof window !== "undefined" && !window.supabase) {
  window.supabase = supabase;
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
    user.app_metadata = { ...(user.app_metadata || {}), role };
    try {
      if (!user.user_metadata) user.user_metadata = {};
      Object.defineProperty(user.user_metadata, "role", {
        value: role,
        writable: false,
        enumerable: false,
        configurable: true
      });
    } catch (err) {
      console.warn("Unable to expose legacy in-memory role:", err);
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
