const test=require("node:test");
const assert=require("node:assert/strict");
const {createHmac}=require("node:crypto");
const {createRoomToken}=require("../netlify/functions/_lib/spaces-token.cjs");
const USER="11111111-1111-4111-8111-111111111111";
const ROOM="22222222-2222-4222-8222-222222222222";
function decode(token){
 const [header,payload,signature]=token.split(".");
 const correct=createHmac("sha256","testing-secret").update(header+"."+payload).digest("base64url");
 assert.equal(signature,correct);
 return JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
}
test("listeners cannot publish microphones",()=>{
 const payload=decode(createRoomToken({apiKey:"test",apiSecret:"testing-secret",userId:USER,roomId:ROOM,role:"listener",now:1000000}));
 assert.equal(payload.video.roomJoin,true);
 assert.equal(payload.video.room,"space_"+ROOM);
 assert.equal(payload.video.canPublish,false);
 assert.deepEqual(payload.video.canPublishSources,[]);
 assert.equal(payload.exp-payload.iat,120);
});
test("only hosts and approved speakers can publish microphone audio",()=>{
 for(const role of ["host","speaker"]){
   const payload=decode(createRoomToken({apiKey:"test",apiSecret:"testing-secret",userId:USER,roomId:ROOM,role,now:1000000}));
   assert.equal(payload.video.canPublish,true);
   assert.deepEqual(payload.video.canPublishSources,["microphone"]);
   assert.equal(payload.video.roomAdmin,undefined);
 }
 assert.throws(()=>createRoomToken({apiKey:"x",apiSecret:"y",userId:USER,roomId:"../../room",role:"host"}));
});
test("live audio server validates credentials and rejects untrusted WS URLs",()=>{
 const fs=require("node:fs");
 const source=fs.readFileSync("netlify/functions/spaces-token.js","utf8");
 assert.match(source,/getUserWithTrustedRole/);
 assert.match(source,/participant\.state!=="present"/);
 assert.match(source,/now-lastSeen>120000/);
 assert.match(source,/LIVEKIT_API_SECRET/);
 assert.doesNotMatch(source,/roomAdmin:\s*true/);
});
