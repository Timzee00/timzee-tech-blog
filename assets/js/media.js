import { createSignedMediaCache } from "./signed-media-cache.mjs";
import { getChatMediaPath } from "./chat-media-path.mjs";
import { supabase, getCurrentUser } from "./supabase.js";

const PUBLIC_BUCKET = "media";
const CHAT_BUCKET = "chat-media";
const CHAT_FOLDER = "direct-messages";
const REFRESH_BEFORE_SECONDS = 10 * 60;

function getExtension(filename = "") {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  return parts.pop().toLowerCase();
}

function isChatMediaUrl(value = "") {
  try {
    const url = new URL(value, window.location.origin);
    return url.pathname.includes(`/storage/v1/object/sign/${CHAT_BUCKET}/`);
  } catch (_) {
    return false;
  }
}

function getTokenExpiry(urlValue = "") {
  try {
    const url = new URL(urlValue, window.location.origin);
    const token = url.searchParams.get("token");
    if (!token) return 0;
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return Number(decoded.exp || 0);
  } catch (_) {
    return 0;
  }
}

async function signChatMedia(path, accessToken) {
  const response = await fetch("/.netlify/functions/chat-media-sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ path })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok || !payload?.signedUrl) {
    throw new Error(payload?.error || "Unable to secure chat media.");
  }

  return payload.signedUrl;
}

const signedMediaCache = createSignedMediaCache({
  sign: signChatMedia,
  expiresAt: url => getTokenExpiry(url) * 1000
});
supabase.auth.onAuthStateChange((_event, session) => {
  signedMediaCache.setSession(session?.access_token || '');
});
async function requestChatSignedUrl(path) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return signedMediaCache.get(path, data?.session?.access_token);
}

async function refreshChatMediaElement(element) {
  if (!element || !element.isConnected) return;
  const source = element.getAttribute("src") || element.getAttribute("href") || "";
  if (!isChatMediaUrl(source)) return;

  const expiry = getTokenExpiry(source);
  const now = Math.floor(Date.now() / 1000);
  if (expiry && expiry > now + REFRESH_BEFORE_SECONDS) return;

  const path = getChatMediaPath(source);
  if (!path) return;
  if (element.dataset.chatMediaRefreshing === "true") return;

  element.dataset.chatMediaRefreshing = "true";
  try {
    const signedUrl = await requestChatSignedUrl(path);
    if (!signedUrl || !element.isConnected) return;
    // The same DOM node may have been reused while signing was pending.
    if ((element.getAttribute("src") || element.getAttribute("href") || "") !== source) return;
    if (element.hasAttribute("src")) element.setAttribute("src", signedUrl);
    if (element.hasAttribute("href")) element.setAttribute("href", signedUrl);
  } catch (error) {
    console.warn("Chat media refresh failed:", error);
  } finally {
    delete element.dataset.chatMediaRefreshing;
    const current = element.getAttribute("src") || element.getAttribute("href") || "";
    if (element.isConnected && current !== source) void refreshChatMediaElement(element);
  }
}

function scanChatMedia(root = document) {
  const elements = [];
  if (root instanceof Element && (root.matches("img,video,audio,a") || root.hasAttribute("src") || root.hasAttribute("href"))) {
    elements.push(root);
  }
  if (root.querySelectorAll) {
    elements.push(...root.querySelectorAll("img[src],video[src],audio[src],a[href]"));
  }
  elements.forEach((element) => {
    void refreshChatMediaElement(element);
  });
}

function installChatMediaRefresh() {
  if (window.__timzeeChatMediaRefreshInstalled) return;
  window.__timzeeChatMediaRefreshInstalled = true;

  const start = () => {
    scanChatMedia(document);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) scanChatMedia(node);
          });
        } else if (mutation.type === "attributes") {
          const target = mutation.target;
          if (target instanceof Element) void refreshChatMediaElement(target);
        }
      });
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "href"]
    });

    window.setInterval(() => scanChatMedia(document), 30 * 60 * 1000);
  };

  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start, { once: true });
}

// Resize oversized still pictures before upload, so every subsequent viewer
// downloads fewer bytes. Never modify animation, video, audio, SVG or documents.
// Unsupported browsers and conversion errors safely keep the original file.
export async function optimizeImageForUpload(file,{maxDimension=1440}={}){
  if(!file||!/^image\/(?:jpeg|png)$/i.test(String(file.type||""))||
     file.size<180*1024||typeof createImageBitmap!=="function"||
     typeof document==="undefined")return file;
  let bitmap=null;
  try{
    bitmap=await createImageBitmap(file);
    const max=Math.max(256,Math.min(1920,Number(maxDimension)||1440));
    const ratio=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*ratio));
    const height=Math.max(1,Math.round(bitmap.height*ratio));
    if(!width||!height)return file;
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx)return file;
    ctx.drawImage(bitmap,0,0,width,height);
    const result=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",0.82));
    if(!result||result.type!=="image/webp"||result.size>=file.size*0.88)return file;
    const name=String(file.name||"photo").replace(/\.(?:jpe?g|png)$/i,"")+".webp";
    return new File([result],name,{type:"image/webp",lastModified:file.lastModified||Date.now()});
  }catch(error){
    console.warn("Image optimization skipped:",error?.message||"unsupported image");
    return file;
  }finally{try{bitmap?.close?.()}catch{}}
}

export async function uploadMedia(file, folder = "uploads") {
  if (!file) return "";

  const imageFolder=String(folder||"");
  const maxDimension=/avatar|profile/i.test(imageFolder)?512:
    /stor(?:y|ies)/i.test(imageFolder)?1080:1440;
  const preparedFile=await optimizeImageForUpload(file,{maxDimension});
  const ext = getExtension(preparedFile.name);
  const fileName = `${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const isChatMedia = folder === CHAT_FOLDER;
  let bucket = PUBLIC_BUCKET;
  let path = `${folder}/${fileName}`;

  if (isChatMedia) {
    const user = await getCurrentUser();
    if (!user?.id) throw new Error("You must be signed in to upload chat media.");
    bucket = CHAT_BUCKET;
    path = `${CHAT_FOLDER}/${user.id}/${fileName}`;
  }

  try {
    const result = await supabase.storage.from(bucket).upload(path, preparedFile, {
      cacheControl: "3600",
      upsert: false,
      contentType: preparedFile.type || undefined
    });

    if (result.error) {
      console.error("Upload error:", {
        message: result.error.message,
        status: result.error.status,
        details: result.error
      });

      if (result.error.message?.includes("policy") || result.error.status === 403) {
        throw new Error(
          `Storage policy blocked upload in "${folder}". ${result.error.message || "Check folder permissions and RLS policies."}`
        );
      }
      throw new Error(result.error.message || "Upload failed");
    }

    if (isChatMedia) {
      return await requestChatSignedUrl(path);
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || "";
  } catch (error) {
    console.error("Upload exception:", error);
    throw error;
  }
}

installChatMediaRefresh();
