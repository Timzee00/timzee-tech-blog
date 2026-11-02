const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=filename=>fs.readFileSync(path.resolve(__dirname,"..",filename),"utf8");

test("homepage never downloads a topic video merely to show a trending card",()=>{
  const homepage=read("assets/js/app.js"),css=read("assets/css/home.css");
  assert.match(homepage,/topic-video-link/);
  assert.match(homepage,/Video discussion · Open to watch/);
  assert.doesNotMatch(homepage,/<video muted playsinline controls src="\$\{mediaUrl\}"/);
  assert.match(css,/\.topic-video-link/);
});

test("missing video gallery thumbnails show a static card, not a streamed frame",()=>{
  const grid=read("videos.html"),styles=read("assets/css/content-pages.css");
  assert.match(grid,/tz-video-cover-placeholder tz-video-cover-missing/);
  assert.doesNotMatch(grid,/data-cover-src/);
  assert.doesNotMatch(grid,/hydrateLegacyCovers/);
  assert.match(grid,/captureVideoFrame=captureVideoThumbnail/);
  assert.match(styles,/tz-video-cover-missing/);
});

test("reels start with no video source, hydrate active only, and pause on background",()=>{
  const page=read("video.html");
  const reelTag=page.match(/<video class="reel-video"[^>]*>/)?.[0];
  assert.ok(reelTag);
  assert.match(reelTag,/data-video-src/);
  assert.match(reelTag,/preload="none"/);
  assert.doesNotMatch(reelTag,/\ssrc=/);
  const start=page.indexOf("function hydrateNearby(index) {");
  const end=page.indexOf("// Autoplay active video, pause others",start);
  assert.ok(start>0&&end>start);
  const logic=page.slice(start,end);
  assert.match(logic,/candidate\.preload="none"/);
  assert.match(logic,/candidate\.src=source/);
  assert.doesNotMatch(logic,/candidate\.load\(/);
  assert.doesNotMatch(logic,/index-1|index\+1|position/);
  assert.match(page,/state\.preferences\.videos\.dataSaver/);
  assert.match(page,/document\.visibilityState==="hidden"/);
  assert.match(page,/document\.addEventListener\("visibilitychange",pauseBackgroundReels\)/);
  assert.match(page,/window\.addEventListener\("pagehide"/);
});

test("secondary video surfaces do not preload entire media collections",()=>{
  const home=read("assets/js/app.js");
  const fyp=read("assets/js/fyp.js"),stories=read("stories.html");
  const post=read("assets/js/post.js");
  assert.match(fyp,/fyp-inline-video" controls playsinline preload="none" loading="lazy"/);
  assert.match(stories,/state\.storyActiveVideo\?\.pause\(\)/);
  assert.match(stories,/video\.preload = "metadata"/);
  assert.doesNotMatch(stories,/video\.preload = "auto"/);
  assert.match(post,/preload="none"/);
  assert.doesNotMatch(home,/<video muted playsinline controls src=/);
});

test("image upload compression is safe, bounded, and retains originals when unsupported",async()=>{
  const code=read("assets/js/media.js");
  const begin=code.indexOf("export async function optimizeImageForUpload");
  const end=code.indexOf("export async function uploadMedia",begin);
  assert.ok(begin>0&&end>begin);
  const helper=code.slice(begin,end).replace(/^export\s+/,"");
  const dimensions={},state={close:0};
  class FakeFile{
    constructor(parts,name,meta){
      this.size=parts.reduce((n,item)=>n+item.size,0);
      this.name=name;this.type=meta.type;this.lastModified=meta.lastModified;
    }
  }
  const env={
    File:FakeFile,Date,console,
    createImageBitmap:async()=>({width:2400,height:1600,close(){state.close++}}),
    document:{createElement:tag=>{
      assert.equal(tag,"canvas");
      return {
        getContext:()=>({drawImage(){}}),
        set width(v){dimensions.width=v},get width(){return dimensions.width},
        set height(v){dimensions.height=v},get height(){return dimensions.height},
        toBlob:fn=>fn({size:93000,type:"image/webp"})
      };
    }}
  };
  const compress=vm.runInNewContext(helper+";optimizeImageForUpload;",env);
  const photo={size:900000,type:"image/jpeg",name:"portrait.jpg",lastModified:42};
  const converted=await compress(photo,{maxDimension:1080});
  assert.equal(converted.type,"image/webp");
  assert.equal(converted.size,93000);
  assert.equal(converted.name,"portrait.webp");
  assert.equal(dimensions.width,1080);
  assert.equal(dimensions.height,720);
  assert.equal(state.close,1);
  const gif={size:2000000,type:"image/gif",name:"animation.gif"};
  assert.equal(await compress(gif),gif,"animated images are not flattened");
  const small={...photo,size:100000};
  assert.equal(await compress(small),small,"small images are not needlessly reencoded");
  const sound={size:900000,type:"audio/mp4",name:"sound.m4a"};
  assert.equal(await compress(sound),sound,"audio is never converted");
});
test("optimized uploads save matching extension and MIME without altering videos or music",()=>{
 const media=read("assets/js/media.js"),story=read("assets/js/stories.js");
 assert.match(media,/const preparedFile=await optimizeImageForUpload\(file/);
 assert.match(media,/getExtension\(preparedFile\.name\)/);
 assert.match(media,/\.upload\(path, preparedFile,/);
 assert.match(media,/contentType: preparedFile\.type/);
 assert.match(story,/music\?file:await optimizeImageForUpload\(file/);
 assert.match(story,/from\(PRIVATE_STORY_BUCKET\)\.upload\(path,preparedFile/);
 const videos=read("assets/js/videos-marketplace.js");
 assert.match(videos,/captureVideoThumbnail/);
 assert.match(videos,/cacheControl: "604800"/);
});
