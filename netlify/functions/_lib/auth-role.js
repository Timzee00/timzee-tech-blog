async function getUserWithTrustedRole(supabase, token) {
  if (!token) return { error: "Missing auth token." };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: "Invalid auth token." };

  const user = data.user;
  const profileResult = await supabase
    .from("profiles")
    .select("role,account_status")
    .eq("id", user.id)
    .maybeSingle();

  // Profiles are authoritative. A database failure must not restore an old
  // privileged role from auth metadata after a demotion or suspension.
  if (profileResult.error) return { error: "Unable to verify account permissions." };
  if (!profileResult.data) return { error: "Account profile is unavailable." };
  if (profileResult.data.account_status !== "active") return { error: "Account is not active." };
  return { user, role: profileResult.data.role || "user" };
}

async function requireRole(supabase, token, allowedRoles, message) {
  const context = await getUserWithTrustedRole(supabase, token);
  if (context.error) return context;
  if (!allowedRoles.includes(context.role)) return { error: message };
  return context;
}

function roleFromUser(user) {
  return user?.app_metadata?.role || "user";
}

module.exports = { getUserWithTrustedRole, requireRole, roleFromUser };
