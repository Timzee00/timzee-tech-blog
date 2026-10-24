const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.resolve(__dirname,"../super/professional-panel.html"),"utf8");
test("super admin has visible accessible tier and reason controls",()=>{
 const cards=html.slice(html.indexOf("const cards = users.map((user)"),html.indexOf('renderList("allUsersContainer", cards, "No users found.")'));
 assert.match(cards,/data-verification-tier/);
 assert.match(cards,/data-verification-reason/);
 assert.match(cards,/minlength="25"/);
 assert.match(cards,/maxlength="1800"/);
 assert.match(cards,/data-verification-feedback role="status"/);
 assert.match(cards,/data-user-action="unverify"/);
 assert.match(cards,/data-user-action="\$\{user.is_verified \? "set_tier" : "verify"\}"/);
 assert.match(cards,/Business verification requires formal organization review/);
});
test("super admin actions read the visible reason and do not use hidden prompt dialogs",()=>{
 const start=html.indexOf('const loadUsers = async ()');
 const end=html.indexOf("} catch (err) {",start);
 const handler=html.slice(start,end);
 assert.match(handler,/reasonField\.value/);
 assert.match(handler,/reason\.length < 25/);
 assert.match(handler,/verificationTier/);
 assert.match(handler,/updateUserAction\(btn\.dataset\.userId, action, reason, verificationTier\)/);
 assert.doesNotMatch(handler,/window\.appUI\.prompt\(/);
});
