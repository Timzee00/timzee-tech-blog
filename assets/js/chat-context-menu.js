import { supabase } from "./supabase.js";
import { escapeHTML, reportAppError } from "./utils.js";

const MENU_ID = "chatMessageContextMenu";
let currentMessage = null;
let pressTimer = null;
let suppressNextContext = false;

function messageText(messageEl) {
  return messageEl?.querySelector(".chat-message-body")?.textContent?.trim() || "";
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
    <button type="button" data-message-action="report" role="menuitem">Report</button>
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
  const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - rect.width - 8));
  const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeMenu() {
  const menu = document.getElementById(MENU_ID);
  if (menu) menu.hidden = true;
  currentMessage = null;
}

async function askAI(messageEl) {
  if (!messageEl) return;
  const text = messageText(messageEl);
  const media = messageEl.querySelector("img,video,audio,.message-file");
  const attachmentType = media ? (media.matches("img") ? "image" : media.matches("video") ? "video" : media.matches("audio") ? "audio" : "file") : "";
  const attachmentLabel = attachmentType ? `Attachment type: ${attachmentType}.` : "";
  const context = [
    "I selected content from a Timzee Tech Hub chat.",
    attachmentLabel,
    text ? `Message:\n${text}` : "The selected content has no text message body."
  ].filter(Boolean).join("\n\n");
  window.location.href = `ai-chat.html?context=${encodeURIComponent(context)}`;
}

async function handleMenuAction(event) {
  const button = event.target.closest("[data-message-action]");
  if (!button || !currentMessage) return;
  const action = button.dataset.messageAction;
  const messageEl = currentMessage;
  closeMenu();

  try {
    if (action === "reply") {
      messageEl.dispatchEvent(new CustomEvent("timzee:reply-message", { bubbles: true, detail: { messageId: messageEl.dataset.messageId } }));
      return;
    }
    if (action === "copy") {
      const text = messageText(messageEl);
      if (text && navigator.clipboard) await navigator.clipboard.writeText(text);
      return;
    }
    if (action === "ask-ai") {
      await askAI(messageEl);
      return;
    }
    if (action === "copy-media") {
      const media = messageEl.querySelector("img[src],video[src],audio[src],a[href]");
      const url = media?.getAttribute("src") || media?.getAttribute("href") || "";
      if (url && navigator.clipboard) await navigator.clipboard.writeText(url);
      return;
    }
    if (action === "report") {
      const eventDetail = { messageId: messageEl.dataset.messageId };
      messageEl.dispatchEvent(new CustomEvent("timzee:report-message", { bubbles: true, detail: eventDetail }));
    }
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
  if (suppressNextContext) {
    suppressNextContext = false;
    return;
  }
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
  document.addEventListener("click", (event) => {
    if (!event.target.closest(`#${MENU_ID}`)) closeMenu();
  });
  window.addEventListener("scroll", closeMenu, true);
  window.addEventListener("resize", closeMenu);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
