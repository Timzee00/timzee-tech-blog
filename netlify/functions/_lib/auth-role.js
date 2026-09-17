async function getUserWithTrustedRole(supabase, token) {
  if (!token) return { error: "Missing auth token." };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: "Invalid auth token." };

  const user = data.user;
  let role = user.app_metadata?.role || user.user_metadata?.role || null;

  const profileResult = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profileResult.error && profileResult.data?.role) role = profileResult.data.role;

  return { user, role: role || "user" };
}

async function requireRole(supabase, token, allowedRoles, message) {
  const context = await getUserWithTrustedRole(supabase, token);
  if (context.error) return context;
  if (!allowedRoles.includes(context.role)) return { error: message };
  return context;
}

function roleFromUser(user) {
  return user?.app_metadata?.role || user?.user_metadata?.role || "user";
}

module.exports = { getUserWithTrustedRole, requireRole, roleFromUser };
