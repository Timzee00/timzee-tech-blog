import { supabase, getCurrentUser } from "./supabase.js";
import { escapeHTML, reportAppError } from "./utils.js";

const MENU_ID = "chatMessageContextMenu";
let currentMessage = null;
let pressTimer = null;
let suppressNextContext = false;

function messageText(messageEl) {
  return messageEl?.querySelector(".chat-message-body")?.textContent?.trim() || "";
}

function messageAuthor(messageEl) {
  return messageEl?.querySelector(".chat-message-author")?.textContent?.trim() || "Member";
}

function isMediaMessage(messageEl) {
  return Boolean(messageEl?.querySelector("img,video,audio,.message-file"));
}

function createMenu() {
  let menu = document.getElementById(MENU_ID);
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = MENU_ID;
  menu.className = "chat-message-context-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" data-message-action="reply" role="menuitem">Reply</button>
    <button type="button" data-message-action="copy" role="menuitem">Copy message</button>
    <button type="button" data-message-action="ask-ai" role="menuitem">Ask AI</button>
    <button type="button" data-message-action="copy-media" role="menuitem" hidden>Copy media link</button>
    <button type="button" data-message-action="report" role="menuitem">Report message</button>
  `;
  document.body.appendChild(menu);
  menu.addEventListener("click", handleMenuAction);
  return menu;
}

function openMenu(messageEl, x, y) {
  const menu = createMenu();
  currentMessage = messageEl;
  const hasText = Boolean(messageText(messageEl));
  const media = isMediaMessage(messageEl);
  menu.querySelector('[data-message-action="copy"]').hidden = !hasText;
  menu.querySelector('[data-message-action="copy-media"]').hidden = !media;
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(Math.max(8, x), Math.max(8, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.min(Math.max(8, y), Math.max(8, window.innerHeight - rect.height - 8))}px`;
}

function closeMenu() {
  const menu = document.getElementById(MENU_ID);
  if (menu) menu.hidden = true;
  currentMessage = null;
}

function startReply(messageEl) {
  const input = document.getElementById("chatBody");
  if (!input) return;
  const text = messageText(messageEl);
  const author = messageAuthor(messageEl);
  const quote = text ? `> ${author}: ${text.replace(/\n/g, "\n> ")}\n\n` : `Replying to ${author}: `;
  input.value = `${quote}${input.value}`;
  input.focus();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function askAI(messageEl) {
  const text = messageText(messageEl);
  const media = messageEl.querySelector("img,video,audio,.message-file");
  const attachmentType = media ? (media.matches("img") ? "image" : media.matches("video") ? "video" : media.matches("audio") ? "audio" : "file") : "";
  const context = [
    "I selected content from a Timzee Tech Hub chat.",
    attachmentType ? `Attachment type: ${attachmentType}.` : "",
    text ? `Message from ${messageAuthor(messageEl)}:\n${text}` : "The selected content has no text message body."
  ].filter(Boolean).join("\n\n");
  window.location.href = `ai-chat.html?context=${encodeURIComponent(context)}`;
}

async function reportMessage(messageEl) {
  const user = await getCurrentUser();
  if (!user?.id) throw new Error("Please sign in to report a message.");
  const reason = window.prompt("Why are you reporting this message?", "Spam or inappropriate content");
  if (!reason) return;
  const id = messageEl.dataset.messageId;
  if (!id) throw new Error("Message identifier is missing.");
  const result = await supabase.from("content_reports").insert({
    id: crypto.randomUUID(),
    reporter_id: user.id,
    content_type: "direct_message",
    content_id: id,
    reason: String(reason).slice(0, 500),
    status: "open",
    metadata: { source: "chat-context-menu" }
  });
  if (result.error) throw result.error;
  window.siteToast?.("Report submitted.", { type: "success", title: "Message reported" });
}

async function handleMenuAction(event) {
  const button = event.target.closest("[data-message-action]");
  if (!button || !currentMessage) return;
  const action = button.dataset.messageAction;
  const messageEl = currentMessage;
  closeMenu();
  try {
    if (action === "reply") startReply(messageEl);
    else if (action === "copy") {
      const text = messageText(messageEl);
      if (text && navigator.clipboard) await navigator.clipboard.writeText(text);
      window.siteToast?.("Message copied.", { type: "success" });
    } else if (action === "ask-ai") await askAI(messageEl);
    else if (action === "copy-media") {
      const media = messageEl.querySelector("img[src],video[src],audio[src],a[href]");
      const url = media?.getAttribute("src") || media?.getAttribute("href") || "";
      if (url && navigator.clipboard) await navigator.clipboard.writeText(url);
      window.siteToast?.("Media link copied.", { type: "success" });
    } else if (action === "report") await reportMessage(messageEl);
  } catch (error) {
    reportAppError(error, "Chat message action failed");
  }
}

function handlePointerDown(event) {
  const message = event.target.closest(".chat-message");
  if (!message || event.button === 2) return;
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    suppressNextContext = true;
    openMenu(message, event.clientX || window.innerWidth / 2, event.clientY || window.innerHeight / 2);
  }, 550);
}
function handlePointerUp() { clearTimeout(pressTimer); }
function handlePointerCancel() { clearTimeout(pressTimer); }
function handleContextMenu(event) {
  const message = event.target.closest(".chat-message");
  if (!message) return;
  event.preventDefault();
  if (suppressNextContext) { suppressNextContext = false; return; }
  openMenu(message, event.clientX, event.clientY);
}

function boot() {
  const target = document.getElementById("chatMessages");
  if (!target || document.body.dataset.chatContextInstalled === "true") return;
  document.body.dataset.chatContextInstalled = "true";
  target.addEventListener("pointerdown", handlePointerDown);
  target.addEventListener("pointerup", handlePointerUp);
  target.addEventListener("pointercancel", handlePointerCancel);
  target.addEventListener("pointermove", handlePointerCancel);
  target.addEventListener("contextmenu", handleContextMenu);
  document.addEventListener("click", (event) => { if (!event.target.closest(`#${MENU_ID}`)) closeMenu(); });
  window.addEventListener("scroll", closeMenu, true);
  window.addEventListener("resize", closeMenu);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
