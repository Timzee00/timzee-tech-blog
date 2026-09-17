import { supabase, getCurrentUser } from "./supabase.js";

const PUBLIC_BUCKET = "media";
const CHAT_BUCKET = "chat-media";
const CHAT_FOLDER = "direct-messages";
const SIGNED_URL_TTL = 60 * 60;
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

function getChatMediaPath(value = "") {
  try {
    const url = new URL(value, window.location.origin);
    const marker = `/storage/v1/object/sign/${CHAT_BUCKET}/`;
    const index = url.pathname.indexOf(marker);
    if (index === -1) return "";
    return decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch (_) {
    return "";
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

async function requestChatSignedUrl(path) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return "";

  const response = await fetch("/.netlify/functions/chat-media-sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store",
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
    if (element.hasAttribute("src")) element.setAttribute("src", signedUrl);
    if (element.hasAttribute("href")) element.setAttribute("href", signedUrl);
  } catch (error) {
    console.warn("Chat media refresh failed:", error);
  } finally {
    delete element.dataset.chatMediaRefreshing;
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

export async function uploadMedia(file, folder = "uploads") {
  if (!file) return "";

  const ext = getExtension(file.name);
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
    const result = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined
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
