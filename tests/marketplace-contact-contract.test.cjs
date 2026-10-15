const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const listing=fs.readFileSync("listing.html","utf8");
const marketplace=fs.readFileSync("marketplace.html","utf8");
test("marketplace seller cards provide an explicit contact flow",()=>{
 assert.match(marketplace,/listing\.html\?id=.*&contact=1/);
 assert.match(listing,/get\("contact"\)==="1"/);
 assert.match(listing,/contactBtn.*click\(\)/);
});
test("login redirects back to the same listing with contact flow still selected",()=>{
 assert.match(listing,/encodeURIComponent\("listing\.html\?id="\+state\.itemId\+"&contact=1"\)/);
});
test("private sellers show a working inquiry form instead of a hidden element",()=>{
 const start=listing.indexOf("if (state.sellerProfile && state.sellerProfile.allow_messages === false)");
 const end=listing.indexOf('messageUser("Checking available contact options',start);
 assert.ok(start>0&&end>start);
 const branch=listing.slice(start,end);
 assert.match(branch,/inquiry\.style\.display="block"/);
 assert.match(branch,/inquiryMessage/);
 assert.match(branch,/scrollIntoView/);
});
test("marketplace contact checks the same DB permissions as Chat before opening a direct message",()=>{
 assert.match(listing,/supabase\.rpc\("can_send_direct_message",\{p_recipient:sellerId\}\)/);
 assert.match(listing,/permission\.data===true/);
 assert.match(listing,/createMarketplaceInquiry/);
});
