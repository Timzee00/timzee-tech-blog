/* Pure helpers shared by the Blipmood chat controller and its tests. */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "heic", "heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "mkv", "avi", "wmv", "flv", "3gp"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "webm"]);

// Postgres direct_messages.created_at is UTC timestamp WITHOUT TIME ZONE.
// PostgREST returns a timezone-less string, which JS otherwise treats as local.
export function asUtcTimestamp(input) {
  const value = String(input || "");
  if (!value) return "";

  const normalized = value.replace(" ", "T");
  return /(?:Z|[+-]\d\d(?::?\d\d)?)$/i.test(normalized)
    ? normalized
    : normalized + "Z";
}

export function getFileExtension(value = "") {
  const cleaned = String(value || "").split("?")[0].split("#")[0];
  const segment = cleaned.split("/").pop() || "";
  const parts = segment.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

export function getMediaTypeFromMime(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  return "file";
}

export function resolveAttachmentType({ mediaType = "", mimeType = "", fileName = "", mediaUrl = "" } = {}) {
  const normalized = String(mediaType || "").toLowerCase();
  if (["image", "video", "audio", "file"].includes(normalized)) return normalized;

  const mimeTypeCategory = getMediaTypeFromMime(mimeType);
  if (mimeTypeCategory) return mimeTypeCategory;

  const extension = getFileExtension(fileName || mediaUrl);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return "file";
}

export function formatFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted = unitIndex === 0 || value >= 100
    ? String(Math.round(value))
    : value.toFixed(1);
  return formatted + " " + units[unitIndex];
}

export function getDisplayFileName(value = "") {
  const cleaned = String(value || "Attachment").split("?")[0].split("#")[0];
  const fileName = cleaned.split("/").pop() || "Attachment";

  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return minutes + ":" + seconds;
}
