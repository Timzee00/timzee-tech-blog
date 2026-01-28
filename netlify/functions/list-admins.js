const { createClient } = require("@supabase/supabase-js");

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

async function requireSuper(supabase, token) {
  if (!token) return { error: "Missing auth token." };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: "Invalid auth token." };
  const role = data.user.user_metadata?.role;
  if (role !== "super") return { error: "Only super admins can access this." };
  return { user: data.user };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Server misconfigured." });
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const guard = await requireSuper(supabase, token);
  if (guard.error) {
    return jsonResponse(403, { error: guard.error });
  }

  const params = event.queryStringParameters || {};
  const perPage = Math.min(Number.parseInt(params.perPage || "200", 10) || 200, 200);
  const maxPages = Math.min(Number.parseInt(params.maxPages || "5", 10) || 5, 10);
  const requestedPage = Number.parseInt(params.page || "0", 10);

  let users = [];
  let hasMore = false;
  let page = 1;

  if (requestedPage > 0) {
    page = requestedPage;
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      return jsonResponse(400, { error: error.message });
    }
    users = data?.users || [];
    hasMore = users.length >= perPage;
  } else {
    page = 1;
    while (page <= maxPages) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) {
        return jsonResponse(400, { error: error.message });
      }
      const batch = data?.users || [];
      users = users.concat(batch);
      if (batch.length < perPage) break;
      page += 1;
    }
    hasMore = false;
    page = 1;
  }

  const admins = (users || []).filter((user) => {
    const role = user.user_metadata?.role;
    return role === "admin" || role === "super";
  });

  const adminIds = admins.map((user) => user.id);
  let postsByAdmin = {};
  if (adminIds.length) {
    const postsResult = await supabase
      .from("posts")
      .select("id, title, author_id, created_at")
      .in("author_id", adminIds);
    if (!postsResult.error && postsResult.data) {
      postsByAdmin = postsResult.data.reduce((acc, post) => {
        const entry = acc[post.author_id] || { count: 0, last: null, recent: [] };
        entry.count += 1;
        const created = new Date(post.created_at);
        if (!entry.last || created > entry.last) entry.last = created;
        entry.recent.push({
          id: post.id,
          title: post.title,
          created_at: post.created_at
        });
        acc[post.author_id] = entry;
        return acc;
      }, {});
    }
  }

  const result = admins.map((user) => {
    const entry = postsByAdmin[user.id] || { count: 0, last: null, recent: [] };
    const recent = entry.recent
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);
    return {
      id: user.id,
      email: user.email,
      role: user.user_metadata?.role || "admin",
      display_name: user.user_metadata?.display_name || user.email?.split("@")[0] || "Admin",
      created_at: user.created_at,
      post_count: entry.count,
      last_post_at: entry.last ? entry.last.toISOString() : null,
      recent_posts: recent
    };
  });

  return jsonResponse(200, { admins: result, page, hasMore });
};
