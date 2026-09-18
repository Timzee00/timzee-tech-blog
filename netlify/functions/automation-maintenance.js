/**
 * Scheduled maintenance for production.
 *
 * The browser should not be responsible for publishing scheduled content,
 * expiring transient records, migrating legacy private-chat media, or fanning
 * out system notifications. Those responsibilities live behind the database
 * RPC and server-side maintenance and run without an admin opening the site.
 */
const { createClient } = require("@supabase/supabase-js");

const CHAT_BUCKET = "chat-media";
const LEGACY_MEDIA_MARKERS = [
  "/storage/v1/object/public/media/",
  "/storage/v1/object/sign/media/"
];
const LEGACY_MEDIA_LIMIT = 25;
const SIGNED_URL_TTL = 60 * 60;

function extractLegacyPath(mediaUrl = "") {
  const value = String(mediaUrl || "");
  const marker = LEGACY_MEDIA_MARKERS.find((candidate) => value.includes(candidate));
  if (!marker) return "";
  const start = value.indexOf(marker) + marker.length;
  const raw = value.slice(start).split("?")[0].split("#")[0];
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return raw;
  }
}

function getFileName(path = "") {
  const normalized = String(path || "").replace(/\\/g, "/");
  return normalized.split("/").pop() || "attachment";
}

async function removeOrphanedLegacyPublicChatMedia(supabase) {
  const [messages, objects] = await Promise.all([
    supabase
      .from("direct_messages")
      .select("media_url")
      .or("media_url.ilike.%/storage/v1/object/public/media/direct-messages/%,media_url.ilike.%/storage/v1/object/sign/media/direct-messages/%")
      .limit(5000),
    supabase
      .from("storage.objects")
      .select("name")
      .eq("bucket_id", "media")
      .like("name", "direct-messages/%")
      .limit(5000)
  ]);

  if (messages.error) throw messages.error;
  if (objects.error) throw objects.error;

  const referenced = new Set(
    (messages.data || [])
      .map((row) => extractLegacyPath(row.media_url))
      .filter(Boolean)
  );

  const orphaned = (objects.data || [])
    .map((row) => String(row.name || ""))
    .filter((name) =>
      name.startsWith("direct-messages/") &&
      name.split("/").slice(2).some((part) => part.startsWith("legacy-")) &&
      !referenced.has(name)
    );

  let removed = 0;
  const failed = [];
  for (let index = 0; index < orphaned.length; index += 100) {
    const batch = orphaned.slice(index, index + 100);
    const result = await supabase.storage.from("media").remove(batch);
    if (result.error) {
      failed.push({ paths: batch, error: result.error.message });
      continue;
    }
    removed += batch.length;
  }

  return { found: orphaned.length, removed, failed };
}

async function migrateLegacyChatMedia(supabase) {
  const result = await supabase
    .from("direct_messages")
    .select("id,media_url,media_type,sender_id")
    .or("media_url.ilike.%/storage/v1/object/public/media/direct-messages/%,media_url.ilike.%/storage/v1/object/sign/media/direct-messages/%")
    .order("created_at", { ascending: true })
    .limit(LEGACY_MEDIA_LIMIT);

  if (result.error) throw result.error;

  const summary = { found: (result.data || []).length, migrated: 0, failed: 0, deleted: 0 };

  for (const message of result.data || []) {
    const sourcePath = extractLegacyPath(message.media_url);
    if (!sourcePath.startsWith("direct-messages/")) {
      summary.failed += 1;
      console.warn("Skipping legacy chat media with unexpected path:", message.id);
      continue;
    }

    const senderId = String(message.sender_id || "").trim();
    if (!senderId) {
      summary.failed += 1;
      console.warn("Skipping legacy chat media without sender:", message.id);
      continue;
    }

    const leafName = getFileName(sourcePath).slice(0, 180) || "attachment";
    const destinationPath = `direct-messages/${senderId}/legacy-${message.id}-${leafName}`;

    try {
      const download = await supabase.storage.from("media").download(sourcePath);
      if (download.error) throw download.error;

      const arrayBuffer = await download.data.arrayBuffer();
      const upload = await supabase.storage.from(CHAT_BUCKET).upload(destinationPath, Buffer.from(arrayBuffer), {
        cacheControl: "3600",
        upsert: false
      });
      if (upload.error && !/already exists/i.test(upload.error.message || "")) throw upload.error;

      const signed = await supabase.storage.from(CHAT_BUCKET).createSignedUrl(destinationPath, SIGNED_URL_TTL);
      if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("Unable to sign migrated chat media.");

      const update = await supabase
        .from("direct_messages")
        .update({ media_url: signed.data.signedUrl, media_path: destinationPath })
        .eq("id", message.id);
      if (update.error) throw update.error;

      summary.migrated += 1;

      const removed = await supabase.storage.from("media").remove([sourcePath]);
      if (removed.error) {
        console.warn("Migrated chat media but could not remove legacy public object:", message.id, removed.error);
      } else {
        summary.deleted += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error("Legacy chat media migration failed:", message.id, error);
    }
  }

  return summary;
}

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Scheduled automation is not configured.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const mediaMigration = await migrateLegacyChatMedia(supabase);
  const orphanCleanup = await removeOrphanedLegacyPublicChatMedia(supabase);
  const { data, error } = await supabase.rpc("process_automation_tick");
  if (error) {
    console.error("Production automation tick failed:", error);
    throw error;
  }

  console.log("Production automation tick completed:", { automation: data, legacyChatMedia: mediaMigration, orphanLegacyPublicChatMedia: orphanCleanup });
};

exports.config = {
  schedule: "*/5 * * * *"
};
