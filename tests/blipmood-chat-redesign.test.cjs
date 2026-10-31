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
  assert.match(js, /function keepPeopleSearchFocus\(event\)/);
});

test("mobile inbox uses remaining viewport for scrollable conversations instead of the old 46vh cap", () => {
  const css = read("assets/css/blipmood-chat-redesign.css");
  const old = read("assets/css/chat.css");
  const html = read("chat.html");

  // Original shared rule was capping the actual list and wasting the rest
  // of the viewport on short phones.
  assert.match(old, /\.chat-tab-panel,[\s\S]*?max-height:\s*46vh/);
  assert.match(css, /Inbox viewport space recovery/);
  assert.match(css, /\.chat-sidebar \.chat-tab-panel:not\(\[hidden\]\)\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?max-height:\s*none;/);
  assert.match(css, /\.chat-sidebar \.chat-tab-panel:not\(\[hidden\]\)\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(css, /\.chat-sidebar \.chat-list\s*\{\s*align-content:\s*start;/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.chat-sidebar\s*\{[\s\S]*?display:flex;[\s\S]*?flex-direction:column;/);
  assert.match(html, /class="chat-list" id="friendList"/);
  assert.match(html, /class="chat-mobile-nav"/);
});

test("compact mobile chat keeps brand, accessible controls and all real filter tabs", () => {
  const css = read("assets/css/blipmood-chat-redesign.css");
  const html = read("chat.html");
  assert.match(css, /\.chat-inbox-wordmark\s*\{[\s\S]*?width:154px;[\s\S]*?height:50px;/);
  assert.match(css, /\.chat-sidebar \.chat-tabs\s*\{[\s\S]*?grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(css, /\.chat-sidebar \.chat-tab:not\(\.chat-tab-secondary\)\s*\{[\s\S]*?min-height:40px;/);
  assert.match(css, /\.chat-mobile-nav :is\(a,button\)\s*\{\s*min-height:44px;/);
  assert.match(css, /@media\(max-width:760px\) and \(max-height:730px\)/);
  assert.match(css, /\.chat-find-people-button\s*\{\s*display:none;/);
  assert.match(html, /id="peopleSearchToggle"[^>]*aria-label="Find people"/);
  for (const tab of ["all", "dms", "groups", "archived", "requests"])
    assert.match(html, new RegExp('data-tab="'+tab+'"'));
});
