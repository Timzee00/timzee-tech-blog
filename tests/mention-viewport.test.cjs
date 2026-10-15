const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const load=()=>import(pathToFileURL(path.resolve(__dirname,"../assets/js/mention-viewport.mjs")).href);
test("Mention panel stays within a phone with raised keyboard",async()=>{
 const {placeMentionMenu:p}=await load();
 const viewport={width:360,height:330,offsetLeft:0,offsetTop:100};
 const menu=p({left:270,top:360,bottom:402},viewport);
 assert.ok(menu.left>=8&&menu.left+menu.width<=352);
 assert.ok(menu.top>=108&&menu.top+menu.maxHeight<=422);
});
test("Mention panel uses visible viewport offset during pinch zoom",async()=>{
 const {placeMentionMenu:p}=await load();
 const viewport={width:250,height:300,offsetLeft:125,offsetTop:200};
 const menu=p({left:330,top:340,bottom:375},viewport);
 assert.ok(menu.left>=133&&menu.left+menu.width<=367);
 assert.ok(menu.top>=208&&menu.top+menu.maxHeight<=492);
});
test("Mention menu prefers below when there is room",async()=>{
 const {placeMentionMenu:p}=await load();
 const menu=p({left:20,top:60,bottom:90},{width:390,height:750});
 assert.ok(menu.top>=90);
});
