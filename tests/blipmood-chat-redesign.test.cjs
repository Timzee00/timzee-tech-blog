const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("Chat retains a five-filter Blipmood inbox and working private controls", () => {
  const html = read("chat.html");
  for (const tab of ["all","dms","groups","requests","archived"])
    assert.match(html, new RegExp('data-tab="'+tab+'"'));
  for (const id of ["friendList","dmsList","groupList","chatBlockedToggle","chatMobileCreate","chatInfoPanel","chatEmojiMenu","chatEmojiToggle"])
    assert.match(html, new RegExp('id="'+id+'"'));
  assert.match(html, /data-tab="blocked"/);
  assert.match(html, /chat-inbox-brand/);
  assert.match(html, /blipmood-chat-redesign.css/);
});

test("the All inbox combines permitted groups and direct messages without made-up messages", () => {
  const js = read("assets/js/chat-v2.js");
  assert.match(js, /function renderUnifiedInbox\(\)/);
  assert.match(js, /const all=\[\.\.\.dms,\.\.\.groups\]/);
  assert.match(js, /\.\.\.state\.groups\.map\(g=>g\.id\)/);
  assert.match(js, /for\(const listId of \["friendList","dmsList","groupList"\]\)/);
  assert.match(js, /state\.previews\.get\(g\.id\)/);
  assert.doesNotMatch(js, /12 members • 8 online/);
});

test("mobile Chat has one navigation bar and desktop group details are an inline panel", () => {
  const css = read("assets/css/blipmood-chat-redesign.css");
  const js = read("assets/js/chat-v2.js");
  assert.match(css, /\.bottom-tab-bar\{display:none!important\}/);
  assert.match(css, /@media\(min-width:1180px\)/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.chat-info-panel\[open\]:not\(:modal\)/);
  assert.match(js, /if\(group\)openConversationDetails\(\{automatic:true\}\)/);
});

test("messaging controls and moderation still use existing safe backend operations", () => {
  const js = read("assets/js/chat-v2.js");
  const html = read("chat.html");
  const emoji = js.indexOf("function setupChatEmojiMenu()");
  const unban = js.indexOf("async function unbanGroupMember()");
  const add = js.indexOf("async function addPeopleToGroup()");
  assert.ok(emoji > 0 && unban > 0 && unban < add);
  assert.match(js, /setPersonalChatView\(\{muted:next\}\)/);
  assert.match(js, /unban_chat_group_member/);
  assert.match(js, /renderInfoPinned\(\)/);
  assert.match(html, /id="groupNotifyBtn"/);
  assert.match(html, /id="infoPinnedList"/);
  assert.match(js, /field\.setRangeText\(emoji,start,end,"end"\)/);
});
