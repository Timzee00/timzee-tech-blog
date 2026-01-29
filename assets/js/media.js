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
  
  try {
    const result = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false
    });
    
    if (result.error) {
      console.error("Upload error:", {
        message: result.error.message,
        status: result.error.status,
        details: result.error
      });
      
      // Check if it's an RLS policy error
      if (result.error.message?.includes("policy") || result.error.status === 403) {
        throw new Error(`Storage RLS Policy Error: ${result.error.message}. Make sure your user has 'admin' or 'super' role for this folder: ${folder}`);
      }
      throw new Error(result.error.message || "Upload failed");
    }
    
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || "";
  } catch (error) {
    console.error("Upload exception:", error);
    throw error;
  }
}
