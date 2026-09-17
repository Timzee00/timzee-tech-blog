import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://duvbcwwprkzzyzikmcol.supabase.co";
// Use the Supabase *anon* key here (never the service_role key).
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJkdXZicHd3cHJrenp5emlrbWNvbCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzY5MTUzNTIyLCJleHAiOjIwODQ3Mjk1MjJ9.d2d9iFKGl7IYA3xR6GZ8HiAjUlBudSPO98o7EHQcdI4";
export const SITE_URL = "https://timzee-tech-blog.netlify.app";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
if (typeof window !== "undefined" && !window.supabase) {
  window.supabase = supabase;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("Session fetch failed", error);
    return null;
  }
  return data.session;
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.warn("User fetch failed", error);
    return null;
  }
  return data.user;
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
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.warn("User fetch failed", error);
    return null;
  }
  const user = data.user;
  if (!user) return null;

  // Authorization roles must never be taken from user-editable user_metadata.
  // app_metadata is server-controlled; profiles is the database fallback.
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

  // Keep the resolved role only on this in-memory user object for UI gating.
  // The app_metadata mirror is used by the canonical getUserRole() helper.
  // For legacy pages that still read user_metadata.role directly, expose a
  // non-enumerable, non-writable in-memory property. It will not be serialized
  // into an Auth update and therefore cannot turn trusted authorization into
  // user-editable persisted metadata.
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

  return user;
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
