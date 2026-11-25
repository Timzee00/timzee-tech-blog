const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const read=name=>fs.readFileSync(path.resolve(__dirname,"..",name),"utf8");

test("download page explains supported Android and iPhone installation paths",()=>{
 const page=read("download.html");
 assert.match(page,/id="androidInstallButton"/);
 assert.match(page,/beforeinstallprompt|Install Blipmood/);
 assert.match(page,/Add to Home Screen/);
 assert.match(page,/Open as Web App/);
 assert.match(page,/Safari/);
 assert.match(page,/pwa-install\.mjs/);
 assert.match(page,/app-download\.css/);
 assert.match(page,/A separate Android APK is not published yet/);
 assert.doesNotMatch(page,/<a[^>]+href=["'][^"']+\.apk(?:[?#][^"']*)?["']/i);
});

test("Android installation prompt is deferred until a deliberate button tap",()=>{
 const source=read("assets/js/pwa-install.mjs");
 assert.match(source,/beforeinstallprompt/);
 assert.match(source,/event\.preventDefault\(\)/);
 assert.match(source,/installButton\?\.addEventListener\("click"/);
 assert.match(source,/promptEvent\.prompt\(\)/);
 assert.match(source,/promptEvent\.userChoice/);
 assert.match(source,/appinstalled/);
 assert.match(source,/display-mode: standalone/);
});

test("shared navigation, footer and sitemap expose the download route",()=>{
 const shell=read("assets/js/site-shell.js");
 assert.match(shell,/addLink\("download\.html", "Install Blipmood"\)/);
 assert.match(shell,/href="\/download\.html">Install app/);
 assert.match(read("sitemap.xml"),/https:\/\/blipmood\.netlify\.app\/download\.html/);
});

test("install route uses the existing PWA manifest and worker without replacing them",()=>{
 const build=read("scripts/build-site.mjs");
 const manifest=JSON.parse(read("app.webmanifest"));
 assert.match(build,/app\.webmanifest/);
 assert.match(build,/pwa-register\.mjs/);
 assert.equal(manifest.display,"standalone");
 assert.equal(manifest.scope,"/");
 assert.match(read("sw.js"),/OFFLINE_CACHE/);
 assert.match(read("sw.js"),/notificationclick/);
 assert.match(read("sw.js"),/request\.headers\.has\("Authorization"\)/);
});
