const { createClient } = require("@supabase/supabase-js");

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

async function resolveRole(supabase, user) {
  let role = user?.user_metadata?.role;
  if (!role && user?.id) {
    const profileResult = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profileResult.data?.role) role = profileResult.data.role;
  }
  return role || "user";
}

async function requireModerator(supabase, token) {
  if (!token) return { error: "Missing auth token." };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: "Invalid auth token." };
  const role = await resolveRole(supabase, data.user);
  if (!["moderator", "admin", "super"].includes(role)) {
    return { error: "Only moderators or admins can access this." };
  }
  return { user: data.user, role };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
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
  const guard = await requireModerator(supabase, token);
  if (guard.error) return jsonResponse(403, { error: guard.error });

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const { action, type, id } = payload;
  if (!action || !type || !id) {
    return jsonResponse(400, { error: "Missing action/type/id." });
  }

  try {
    if (type === "posts") {
      if (action === "publish") {
        await supabase.from("posts").update({ status: "published" }).eq("id", id);
      } else if (action === "unpublish") {
        await supabase.from("posts").update({ status: "draft" }).eq("id", id);
      } else if (action === "delete") {
        await supabase.from("posts").delete().eq("id", id);
      }
    } else if (type === "comments") {
      if (action === "approve") {
        await supabase.from("comments").update({ status: "approved" }).eq("id", id);
      } else if (action === "hide") {
        await supabase.from("comments").update({ status: "pending" }).eq("id", id);
      } else if (action === "delete") {
        await supabase.from("comments").delete().eq("id", id);
      }
    } else if (type === "discussion_messages") {
      if (action === "delete") {
        await supabase.from("discussion_messages").delete().eq("id", id);
      }
    } else if (type === "marketplace_items") {
      if (action === "hide") {
        await supabase.from("marketplace_items").update({ is_available: false }).eq("id", id);
      } else if (action === "delete") {
        await supabase.from("marketplace_items").delete().eq("id", id);
      }
    } else if (type === "videos") {
      if (action === "hide") {
        await supabase.from("videos").update({ is_public: false }).eq("id", id);
      } else if (action === "delete") {
        await supabase.from("videos").delete().eq("id", id);
      }
    } else if (type === "novels") {
      if (action === "hide") {
        await supabase.from("novels").update({ status: "paused" }).eq("id", id);
      } else if (action === "delete") {
        await supabase.from("novels").delete().eq("id", id);
      }
    } else {
      return jsonResponse(400, { error: "Unknown content type." });
    }

    return jsonResponse(200, { ok: true });
  } catch (error) {
    return jsonResponse(400, { error: error.message });
  }
};
