import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://duvbcwwprkzzyzikmcol.supabase.co";
// Use the Supabase *anon* key here (never the service_role key).
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dmJjd3dwcmt6enl6aWttY29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNTM1MjIsImV4cCI6MjA4NDcyOTUyMn0.d2d9iFKGl7IYA3xR6GZ8HiAjUlBudSPO98o7EHQcdI4";
export const SITE_URL = "https://timzee-tech-blog.netlify.app";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

export async function signUp(email, password, displayName = "") {
  const fallbackUsername = email ? email.split("@")[0] : "";
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        username: displayName ? displayName.toLowerCase().replace(/\s+/g, "") : fallbackUsername,
        role: "user"
      },
      emailRedirectTo: SITE_URL ? `${SITE_URL}/login.html` : undefined
    }
  });
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

  // Try to get role from user_metadata first (from JWT)
  let role = user.user_metadata?.role;

  // If role not in JWT metadata, fetch from profiles table as fallback
  if (!role) {
    try {
      const profileResult = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profileResult.data?.role) {
        role = profileResult.data.role;
        // Update the user object so subsequent calls have it
        if (user.user_metadata) {
          user.user_metadata.role = role;
        } else {
          user.user_metadata = { role };
        }
      }
    } catch (err) {
      console.warn("Failed to fetch role from profiles:", err);
    }
  }

  return user;
}

export function getUserRole(user) {
  return user?.user_metadata?.role || "user";
}

export function getDisplayName(user) {
  const fromMeta = user?.user_metadata?.display_name;
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
