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
  const result = await signIn(email, password);
  if (result.error) {
    return { ok: false, message: result.error.message };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, message: "Login failed. Try again." };
  }
  const role = getUserRole(user);
  if (allowedRoles.length && !allowedRoles.includes(role)) {
    await signOut();
    return { ok: false, message: "Access denied for this role." };
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
