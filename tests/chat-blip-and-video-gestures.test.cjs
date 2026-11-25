const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const chat = read("assets/js/chat-v2.js");
const endpoint = read("netlify/functions/chat-blip.js");
const migration = read("supabase/migrations/20261125000300_chat_blip_participant.sql");
const video = read("video.html");
const aiPage = read("ai-chat.html");

test("Blip is invoked from normal and group chat message events", () => {
  assert.match(chat, /invokeBlipForMessage\(message,threadId\)/);
  assert.match(chat, /invokeBlipForMessage\(saved,threadId\)/);
  assert.match(chat, /fetch\("\/.netlify\/functions\/chat-blip"/);
});

test("Blip responds only to an explicit mention or a reply to a Blip message", () => {
  assert.match(endpoint, /@blip\\b/i);
  assert.match(endpoint, /if \(!mentionsBlip && !repliedToBlip\)/);
  assert.match(endpoint, /parent\.data\?\.is_blip === true/);
  assert.match(endpoint, /if \(!source \|\| source\.is_blip/);
});

test("Blip session context starts at invocation and is bounded", () => {
  assert.match(endpoint, /created_at", session\.invoked_at/);
  assert.match(endpoint, /MAX_CONTEXT_MESSAGES = 30/);
  assert.match(endpoint, /MAX_CONTEXT_CHARS = 1200/);
  assert.match(endpoint, /You are Blip/);
});

test("Blip response messages are marked and idempotency is enforced", () => {
  assert.match(endpoint, /is_blip: true/);
  assert.match(endpoint, /chat_ai_events/);
  assert.match(endpoint, /23505/);
  assert.match(migration, /source_message_id uuid PRIMARY KEY/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS is_blip boolean/);
  assert.match(migration, /guard_blip_chat_message/);
  assert.match(migration, /auth\.role\(\).*service_role/);
});

test("Blip messages render as Blip and reply quotes identify Blip", () => {
  assert.match(chat, /const isBlip=m\.is_blip===true/);
  assert.match(chat, /isBlip\?'Blip'/);
  assert.match(chat, /parent\.is_blip\?"Blip"/);
  assert.match(chat, /author:m\.is_blip\?"Blip"/);
  assert.match(aiPage, /<strong id="aiChatTitle">Blip<\/strong>/);
});

test("Holding either outer side of a reel temporarily activates 2x speed", () => {
  assert.match(video, /event\.clientX-rect\.left/);
  assert.match(video, /rect\.width\*\.25/);
  assert.match(video, /rect\.width\*\.75/);
  assert.match(video, /heldVideo\.playbackRate=2/);
  assert.match(video, /heldVideo\.playbackRate=holdOriginalRate/);
  assert.match(video, /pointerup/);
  assert.match(video, /pointercancel/);
  assert.match(video, /setPointerCapture/);
  assert.match(video, /reel-hold-speed/);
});

test("The AI identity is named Blip in its dedicated chat page", () => {
  assert.match(aiPage, /<title>Blip — Blipmood<\/title>/);
  assert.match(aiPage, /Ask Blip anything/);
  assert.doesNotMatch(aiPage, /Blipmood AI|Timzee AI/);
});
