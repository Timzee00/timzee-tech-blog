import {
  getCurrentUser,
  getSession,
  getDisplayName,
  getUserRole,
  signIn,
  signOut,
  signUp
} from "./supabase.js";

export async function login(email, password, allowedRoles = []) {
  try {
    const result = await signIn(email, password);
    if (result.error) {
      console.error("SignIn error:", result.error);
      return { 
        ok: false, 
        message: result.error.message || "Login failed. Check your email/password." 
      };
    }
    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, message: "Login failed. Try again." };
    }
    const role = getUserRole(user);
    if (allowedRoles.length && !allowedRoles.includes(role)) {
      await signOut();
      return { 
        ok: false, 
        message: `Access denied. Your role (${role}) is not authorized for this area. Required: ${allowedRoles.join(", ")}` 
      };
    }
    return {
      ok: true,
      session: {
        userId: user.id,
        email: user.email,
        displayName: getDisplayName(user),
        role
      }
    };
  } catch (error) {
    console.error("Login exception:", error);
    return { 
      ok: false, 
      message: `Login error: ${error.message}` 
    };
  }
}

export async function register(email, password, displayName) {
  const result = await signUp(email, password, displayName);
  if (result.error) {
    return { ok: false, message: result.error.message };
  }
  return { ok: true };
}

export async function requireRole(roles = [], redirectUrl) {
  const user = await getCurrentUser();
  if (!user || (roles.length && !roles.includes(getUserRole(user)))) {
    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
    return null;
  }
  return user;
}

export async function logout() {
  await signOut();
}

export { getSession, getCurrentUser, getDisplayName, getUserRole };
