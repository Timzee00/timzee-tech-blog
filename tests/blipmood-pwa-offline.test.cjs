const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),vm=require("node:vm");
const {deflateSync}=require("node:zlib");
const {pathToFileURL}=require("node:url");
const read=p=>fs.readFileSync(path.resolve(__dirname,"..",p),"utf8");

test("Blipmood installs as a standalone, branded PWA with real-sized icons",()=>{
 const manifest=JSON.parse(read("app.webmanifest"));
 assert.equal(manifest.id,"/");
 assert.equal(manifest.scope,"/");
 assert.equal(manifest.display,"standalone");
 assert.equal(manifest.short_name,"Blipmood");
 for(const size of ["192x192","512x512"])
  assert.ok(manifest.icons.some(i=>i.sizes===size&&i.type==="image/png"&&i.purpose==="any"));
 assert.ok(manifest.icons.some(i=>i.sizes==="512x512"&&i.purpose==="maskable"));
 const build=read("scripts/build-site.mjs");
 assert.match(build,/app\.webmanifest/);
 assert.match(build,/await createPwaIcons\(output\)/);
 assert.match(build,/pwa-register\.mjs/);
 assert.match(build,/if \(!staff && enhanced\.includes/);
 assert.match(read("assets/js/pwa-register.mjs"),/requestIdleCallback/);
 assert.match(read("assets/js/pwa-register.mjs"),/navigator\.serviceWorker\.register\("\/sw\.js"/);
 const headers=read("_headers");
 assert.match(headers,/\/sw\.js[\s\S]*?Cache-Control: no-cache/);
 assert.match(headers,/\/app\.webmanifest[\s\S]*?Content-Type: application\/manifest\+json/);
});

test("Offline page supports useful drafts, notes and checklist without pretending to publish",()=>{
 const html=read("offline.html");
 for(const id of ["offlineDraft","offlineNotes","saveDraft","saveNotes","copyDraft","copyNotes","taskForm","taskList"])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/localStorage\.setItem\(KEY/);
 assert.match(html,/navigator\.clipboard\.writeText/);
 assert.match(html,/data\.tasks\.length>=20/);
 assert.match(html,/not encrypted or backed up/);
 assert.match(html,/never publish or send messages automatically/);
 assert.match(read("assets/js/blipmood-unified-menu.mjs"),/Offline workspace/);
});

function workerHarness(){
 const handlers={},stores=new Map(),fetched=[];
 const origin="https://blipmood.netlify.app";
 const makeStore=name=>{
  if(!stores.has(name))stores.set(name,new Map());
  const map=stores.get(name);
  const key=r=>typeof r==="string"?new URL(r,origin).pathname+new URL(r,origin).search:new URL(r.url,origin).pathname+new URL(r.url,origin).search;
  return {
   addAll:async arr=>{for(const item of arr)map.set(key(item),new Response("Offline cached: "+item,{status:200}));},
   match:async r=>map.get(key(r)),
   put:async(r,v)=>{map.set(key(r),v);},
   keys:async()=>Array.from(map.keys()).map(url=>({url:origin+url})),
   delete:async r=>map.delete(key(r))
  };
 };
 const caches={
  open:async name=>makeStore(name),
  keys:async()=>Array.from(stores.keys()),
  delete:async name=>stores.delete(name),
  match:async request=>{for(const name of stores.keys()){const v=await makeStore(name).match(request);if(v)return v;}}
 };
 const self={
  location:{origin},
  addEventListener:(name,fn)=>{handlers[name]=fn;},
  skipWaiting:async()=>{},
  clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async()=>{}},
  registration:{showNotification:async()=>{}}
 };
 async function fetcher(request){fetched.push(request.url||request);throw Error("Network disconnected");}
 vm.runInNewContext(read("sw.js"),{self,URL,Response,Headers,caches,fetch:fetcher},{timeout:4000});
 const dispatch=async name=>{
  let pending;const e={waitUntil(p){pending=Promise.resolve(p);}};
  handlers[name](e);await pending;
 };
 const visit=async({pathname,method="GET",mode="navigate",destination="document",headers=new Headers()}={})=>{
  let answer;const request={url:origin+pathname,method,mode,destination,headers};
  handlers.fetch({request,respondWith(p){answer=Promise.resolve(p);}});
  return answer?await answer:null;
 };
 return{stores,caches,handlers,dispatch,visit,fetched};
}

test("Worker opens a real usable offline page and never caches member HTML or API data",async()=>{
 const w=workerHarness();
 await w.dispatch("install");await w.dispatch("activate");
 const fallback=await w.visit({pathname:"/chat.html?secret=1"});
 assert.ok(fallback);
 assert.match(await fallback.text(),/Offline cached: \/offline\.html/);
 assert.equal(await w.caches.match("/chat.html?secret=1"),undefined);
 assert.equal(await w.visit({pathname:"/.netlify/functions/private",mode:"cors",destination:"",method:"GET"}),null);
 assert.equal(await w.visit({pathname:"/.netlify/functions/private",mode:"cors",destination:"",method:"POST"}),null);
 assert.equal(await w.visit({pathname:"/assets/user/private-chat.png",mode:"no-cors",destination:"image"}),null);
 const source=read("sw.js");
 assert.match(source,/OFFLINE_BRAND_ASSETS/);
 assert.doesNotMatch(source,/await cache\.put\(request,response\.clone\(\)\)/);
 assert.match(source,/isSafeOfflineBrandRequest/);
 assert.equal(await w.visit({pathname:"/assets/css/styles.css",mode:"cors",destination:"style"}),null);
 assert.equal(await w.visit({pathname:"/assets/js/app.js",mode:"cors",destination:"script"}),null);
 const logo=await w.visit({pathname:"/assets/brand/blipmood-pwa-192.png",mode:"no-cors",destination:"image"});
 assert.ok(logo,"pre-cached public PWA image should still work offline");
 assert.match(await logo.text(),/Offline cached/);
 assert.match(source,/request\.headers\.has\("Authorization"\)/);
 assert.match(source,/showNotification\("Blipmood"/);
 assert.match(source,/notificationclick/);
});

test("PNG icon build creates valid 192 and 512 squares using the original approved source",async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"blip-pwa-"));
 const folder=path.join(tmp,"assets","brand");fs.mkdirSync(folder,{recursive:true});
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 const chunk=(name,data)=>{
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const tag=Buffer.from(name);let crc=0xffffffff;
  for(const x of Buffer.concat([tag,data]))crc=crcTable[(crc^x)&255]^(crc>>>8);
  const end=Buffer.alloc(4);end.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([len,tag,data,end]);
 };
 try{
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  const px=Buffer.from([0,255,0,0,255,0,255,0,128, 0,0,0,255,255,255,255,255,255]);
  fs.writeFileSync(path.join(folder,"blipmood-emblem-light.png"),Buffer.concat([
   signature,chunk("IHDR",header),chunk("IDAT",deflateSync(px)),chunk("IEND",Buffer.alloc(0))
  ]));
  fs.copyFileSync(path.join(folder,"blipmood-emblem-light.png"),path.join(folder,"blipmood-emblem-dark.png"));
  const generator=await import(pathToFileURL(path.resolve(__dirname,"../scripts/build-pwa-icons.mjs")).href);
  await generator.createPwaIcons(tmp);
  await generator.createResponsiveEmblemAssets(tmp);
  for(const [filename,size] of [["192",192],["512",512],["maskable-512",512]]){
   const output=fs.readFileSync(path.join(folder,"blipmood-pwa-"+filename+".png"));
   assert.ok(output.subarray(0,8).equals(signature));
   assert.equal(output.readUInt32BE(16),size);
   assert.equal(output.readUInt32BE(20),size);
  }
  for(const theme of ["light","dark"])for(const size of [180,420]){
   const image=fs.readFileSync(path.join(folder,"blipmood-emblem-"+theme+"-"+size+".png"));
   assert.ok(image.subarray(0,8).equals(signature));
   assert.equal(image.readUInt32BE(16),size);
   assert.equal(image.readUInt32BE(20),size);
   assert.equal(image[25],6,"hero image must preserve RGBA transparency");
  }
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
