const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=relative=>fs.readFileSync(path.resolve(__dirname,"..",relative),"utf8");
const forum=read("assets/js/community-forum.mjs");
const discussion=read("discussion.html");
const ai=read("ai-chat.html");
const aiCss=read("assets/css/blipmood-ai-chat.css");
const market=read("assets/css/blipmood-marketplace-premium.css");
const renderer=read("assets/js/ai-message-renderer.mjs");

test("Community Markdown renders real clickable labels and pasted links without raw HTML",async()=>{
 const {renderCommunityMarkdown}=await import("../assets/js/community-markdown.mjs");
 const message="[Added](https://example.com/update) and https://example.org/now. <img src=x onerror=alert(1)>";
 const output=renderCommunityMarkdown(message);
 assert.match(output,/href="https:\/\/example.com\/update"/);
 assert.match(output,/>Added<\/a>/);
 assert.match(output,/href="https:\/\/example.org\/now"/);
 assert.doesNotMatch(output,/<img[^>]*onerror/);
 assert.match(output,/&lt;img/);
 const blocked=renderCommunityMarkdown("[bad](javascript:alert(1))");
 assert.doesNotMatch(blocked,/<a[^>]+javascript:/);
});
test("Forum icons are shared inline SVG, not old emoji placeholders",()=>{
 assert.match(forum,/import \{icon\} from "\.\/icons\.js"/);
 assert.match(forum,/communityIcon\(community\)/);
 assert.match(forum,/communityIcon\(c\)/);
 assert.match(forum,/icon\("arrow-up"\)/);
 assert.doesNotMatch(forum,/icon_emoji\|\|"💬"/);
 assert.match(discussion,/data-bm-icon="home"/);
 assert.match(discussion,/data-bm-icon="bookmark"/);
});
test("Marketplace grid remains compact and never stretches poster art",()=>{
 assert.match(market,/\.marketplace-grid \.listing-card\{align-self:start;height:auto/);
 assert.match(market,/\.marketplace-grid \.listing-info\{display:flex;flex-direction:column;justify-content:flex-start;flex:0 0 auto/);
 assert.match(market,/\.marketplace-grid \.listing-image\{aspect-ratio:1\/1/);
 assert.match(market,/object-fit:contain;object-position:center/);
});
test("AI chat is mobile height-contained with fixed header and copy action",()=>{
 assert.match(ai,/class="blipmood-ai-page"/);
 assert.match(ai,/id="aiChatHeader"/);
 assert.match(ai,/id="aiHeaderNewChat"/);
 assert.match(ai,/Copy response/);
 assert.match(ai,/blipmood-ai-chat\.css/);
 assert.match(aiCss,/#aiChatHeader\{position:sticky;top:0/);
 assert.match(aiCss,/#aiChatMessages\{min-height:0;max-height:none!important;overflow-y:auto/);
 assert.match(renderer,/replace\(\/<br/);
 assert.match(renderer,/const listType=line=>/);
 assert.match(renderer,/[-*+•]/);
 assert.doesNotMatch(ai,/Timzee AI Assistant/);
});
