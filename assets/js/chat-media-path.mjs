const PREFIX = "/storage/v1/object/sign/chat-media/";
const PRIVATE_PATH = /^direct-messages\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+$/i;

// Extract the durable object path, never the signed token. Signing still
// requires database authorization of the requesting chat participant.
export function getChatMediaPath(value = "") {
  try {
    const url = new URL(value, "https://invalid.example");
    if (!["http:", "https:"].includes(url.protocol) || !url.pathname.startsWith(PREFIX)) return "";
    const path = decodeURIComponent(url.pathname.slice(PREFIX.length));
    if (!PRIVATE_PATH.test(path) || path.includes("..") || /[\\\x00-\x1f]/.test(path)) return "";
    return path;
  } catch {
    return "";
  }
}
