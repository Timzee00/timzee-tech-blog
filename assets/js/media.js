import { supabase } from "./supabase.js";

const BUCKET = "media";

function getExtension(filename = "") {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  return parts.pop().toLowerCase();
}

export async function uploadMedia(file, folder = "uploads") {
  if (!file) return "";
  const ext = getExtension(file.name);
  const fileName = `${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
  const path = `${folder}/${fileName}`;
  const result = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false
  });
  if (result.error) {
    console.warn("Upload failed", result.error);
    return "";
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || "";
}
