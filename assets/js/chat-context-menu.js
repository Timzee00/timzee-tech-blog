import { supabase, getCurrentUser } from "./supabase.js";
import { storeChatContext } from "./chat-ai-context.mjs";
import { reportAppError } from "./utils.js";

const MENU_ID = "chatMessageContextMenu";
let currentMessage = null;
let pressTimer = null;
let menuTrigger = null;

function messageText(messageEl) {
  return messageEl?.querySelector(".chat-message-body")?.innerText?.trim() || "";
}

function messageAuthor(messageEl) {
  return messageEl?.dataset.messageAuthor || messageEl?.querySelector(".chat-message-author")?.textContent?.trim() || "Member";
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
  menu.setAttribute("aria-label", "Message actions");
  menu.innerHTML = `
    <button type="button" data-message-action="reply" role="menuitem">Reply</button>
    <button type="button" data-message-action="copy" role="menuitem">Copy message</button>
    <button type="button" data-message-action="ask-ai" role="menuitem">Ask AI</button>
    <button type="button" data-message-action="copy-media" role="menuitem" hidden>Copy media link</button>
    <button type="button" data-message-action="report" role="menuitem">Report message</button>
  `;
  document.body.appendChild(menu);
  menu.addEventListener("click", handleMenuAction);
  menu.addEventListener("keydown", event => {
    const items = [...menu.querySelectorAll('button:not([hidden]):not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); }
    if (event.key === 'Tab') closeMenu();
  });
  return menu;
}

function openMenu(messageEl, x, y) {
  if (!messageEl?.isConnected) return;
  closeMenu(false);
  const menu = createMenu();
  currentMessage = messageEl;
  menuTrigger = messageEl.querySelector('.chat-message-actions');
  menuTrigger?.setAttribute('aria-expanded', 'true');
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
  menu.querySelector('button:not([hidden]):not(:disabled)')?.focus();
}

function closeMenu(restoreFocus = true) {
  const menu = document.getElementById(MENU_ID);
  if (menu) menu.hidden = true;
  menuTrigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus && menuTrigger?.isConnected) menuTrigger.focus();
  menuTrigger = null;
  currentMessage = null;
}

function startReply(messageEl) {
  const input = document.getElementById("chatBody");
  if (!input || input.disabled || !messageEl.isConnected) return;
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
  const user = await getCurrentUser();
  if (!user?.id) throw new Error('Sign in to use selected chat content.');
  const id = storeChatContext(context, user.id);
  window.location.href = `ai-chat.html?context_ref=${encodeURIComponent(id)}`;
}

async function reportMessage(messageEl) {
  const user = await getCurrentUser();
  if (!user?.id) throw new Error("Please sign in to report a message.");
  const reason = await window.appUI.prompt("Why are you reporting this message?", "Spam or inappropriate content");
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
  if (!button || !currentMessage?.isConnected) { closeMenu(false); return; }
  const action = button.dataset.messageAction;
  const messageEl = currentMessage;
  closeMenu();
  try {
    if (action === "reply") startReply(messageEl);
    else if (action === "copy") {
      const text = messageText(messageEl);
      if (!text || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable. Select the message text to copy it.");
      await navigator.clipboard.writeText(text);
      window.siteToast?.("Message copied.", { type: "success" });
    } else if (action === "ask-ai") await askAI(messageEl);
    else if (action === "copy-media") {
      const media = messageEl.querySelector("img[src],video[src],audio[src],a[href]");
      const url = media?.getAttribute("src") || media?.getAttribute("href") || "";
      if (!url || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable. Open the attachment to copy its link.");
      await navigator.clipboard.writeText(url);
      window.siteToast?.("Media link copied.", { type: "success" });
    } else if (action === "report") await reportMessage(messageEl);
  } catch (error) {
    reportAppError(error, "Chat message action failed");
  }
}

function handlePointerDown(event) {
  const message = event.target.closest(".chat-message");
  if (!message || event.pointerType === "mouse" || event.target.closest("button,a,audio,video")) return;
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    openMenu(message, event.clientX || window.innerWidth / 2, event.clientY || window.innerHeight / 2);
  }, 550);
}
function handlePointerUp() { clearTimeout(pressTimer); }
function handlePointerCancel() { clearTimeout(pressTimer); }
function handleContextMenu(event) {
  const message = event.target.closest(".chat-message");
  if (!message) return;
  event.preventDefault();
  openMenu(message, event.clientX, event.clientY);
}

function boot() {
  const target = document.getElementById("chatMessages");
  if (!target || document.body.dataset.chatContextInstalled === "true") return;
  document.body.dataset.chatContextInstalled = "true";
  target.addEventListener("click", event => {
    const button = event.target.closest('.chat-message-actions');
    if (!button) return;
    const rect = button.getBoundingClientRect();
    openMenu(button.closest('.chat-message'), rect.left, rect.bottom);
  });
  target.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    const message = event.target.closest('.chat-message');
    if (!message) return;
    event.preventDefault();
    const rect = event.target.getBoundingClientRect();
    openMenu(message, rect.left, rect.bottom);
  });
  new MutationObserver(() => { if (currentMessage && !currentMessage.isConnected) closeMenu(false); })
    .observe(target, { childList: true, subtree: true });
  target.addEventListener("pointerdown", handlePointerDown);
  target.addEventListener("pointerup", handlePointerUp);
  target.addEventListener("pointercancel", handlePointerCancel);
  target.addEventListener("pointermove", handlePointerCancel);
  target.addEventListener("contextmenu", handleContextMenu);
  document.addEventListener("click", (event) => { if (!event.target.closest(`#${MENU_ID}, .chat-message-actions`)) closeMenu(false); });
  window.addEventListener("scroll", () => closeMenu(false), true);
  window.addEventListener("resize", () => closeMenu(false));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
