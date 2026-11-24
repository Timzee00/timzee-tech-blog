import { supabase } from "./supabase.js";

export const MUSIC_TYPES = new Set(["audio/mpeg","audio/mp4","audio/x-m4a","audio/ogg","audio/webm"]);
const EXTENSIONS = new Set(["mp3","m4a","ogg","webm"]);
export const MAX_MUSIC_BYTES = 10 * 1024 * 1024;

export async function listMusicTracks({ search = "", limit = 60 } = {}) {
  const size = Math.max(1, Math.min(100, Number(limit) || 60));
  let query = supabase.from("music_tracks")
    .select("id,uploader_id,title,artist,storage_path,mime_type,created_at")
    .eq("status", "available")
    .order("created_at", { ascending: false })
    .limit(size);
  const term = String(search || "").trim().replace(/[,%()]/g, " ").slice(0, 80);
  if (term) query = query.or("title.ilike.%"+term+"%,artist.ilike.%"+term+"%");
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(track => ({
    ...track,
    url: supabase.storage.from("music-library").getPublicUrl(track.storage_path).data.publicUrl
  }));
}

export async function uploadMusicTrack(file, { title, artist = "", rightsConfirmed = false } = {}) {
  if (!file || !MUSIC_TYPES.has(file.type)) throw Error("Choose an MP3, M4A, OGG or WebM audio file.");
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  if (!EXTENSIONS.has(extension) || file.size < 1 || file.size > MAX_MUSIC_BYTES)
    throw Error("Music files must be under 10 MB and use MP3, M4A, OGG or WebM.");
  if (!rightsConfirmed) throw Error("Confirm that you own this recording or have permission to distribute it.");
  const cleanTitle = String(title || "").trim().slice(0, 100);
  const cleanArtist = String(artist || "").trim().slice(0, 100);
  if (!cleanTitle) throw Error("Enter the track title.");
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw Error("Sign in before uploading music.");
  const path = user.id + "/" + crypto.randomUUID() + "." + extension;
  const { error: uploadError } = await supabase.storage.from("music-library").upload(path, file, {
    upsert: false, cacheControl: "3600", contentType: file.type
  });
  if (uploadError) throw uploadError;
  const { data, error } = await supabase.from("music_tracks").insert({
    uploader_id: user.id, title: cleanTitle, artist: cleanArtist, storage_path: path,
    mime_type: file.type, file_size_bytes: file.size, rights_confirmed: true, status: "available"
  }).select("id,uploader_id,title,artist,storage_path,mime_type,created_at").single();
  if (error) {
    await supabase.storage.from("music-library").remove([path]);
    throw error;
  }
  return { ...data, url: supabase.storage.from("music-library").getPublicUrl(path).data.publicUrl };
}

export async function reportMusicTrack(trackId, {
  reason, details, claimantContact = "", evidenceUrl = ""
} = {}) {
  const allowed = new Set(["copyright","impersonation","misleading_metadata","harmful_or_illegal","other"]);
  if (!allowed.has(reason)) throw Error("Choose a report reason.");
  const text = String(details || "").trim();
  if (text.length < 10 || text.length > 2000) throw Error("Add details between 10 and 2,000 characters.");
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw Error("Sign in to report a track.");
  const { data, error } = await supabase.from("music_track_reports").insert({
    track_id: trackId, reporter_id: user.id, reason, details: text,
    claimant_contact: String(claimantContact || "").trim() || null,
    evidence_url: String(evidenceUrl || "").trim() || null
  }).select("id").single();
  if (error) throw error;
  return data;
}
