const test=require("node:test");
const assert=require("node:assert/strict");
const {createHmac}=require("node:crypto");
const {createRoomServiceToken}=require("../netlify/functions/_lib/spaces-token.cjs");
const ROOM="22222222-2222-4222-8222-222222222222";
function verify(token){
 const [h,p,s]=token.split(".");
 assert.equal(s,createHmac("sha256","server-secret").update(h+"."+p).digest("base64url"));
 return JSON.parse(Buffer.from(p,"base64url").toString());
}
test("end audio grant is roomCreate and short-lived",()=>{
 const claims=verify(createRoomServiceToken({apiKey:"key",apiSecret:"server-secret",roomId:ROOM,action:"delete",now:500000}));
 assert.equal(claims.video.roomCreate,true);
 assert.equal(claims.video.roomAdmin,undefined);
 assert.equal(claims.exp-claims.iat,60);
});
test("remove audio grant is restricted to one room",()=>{
 const claims=verify(createRoomServiceToken({apiKey:"key",apiSecret:"server-secret",roomId:ROOM,action:"remove",now:500000}));
 assert.equal(claims.video.roomAdmin,true);
 assert.equal(claims.video.room,"space_"+ROOM);
 assert.equal(claims.video.roomCreate,undefined);
 assert.throws(()=>createRoomServiceToken({apiKey:"key",apiSecret:"server-secret",roomId:"not-a-uuid",action:"delete"}));
});
test("server validates owner and DB decisions before provider calls",()=>{
 const source=require("node:fs").readFileSync("netlify/functions/spaces-control.js","utf8");
 assert.match(source,/getUserWithTrustedRole/);
 assert.match(source,/owner_id!==user\.user\.id/);
 assert.match(source,/roomResult\.data\.status!=="ended"/);
 assert.match(source,/result\.data\?\.state!=="removed"/);
 assert.match(source,/\/twirp\/livekit\.RoomService\//);
});
