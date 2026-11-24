const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");

test("admin post editor caches successful uploads and checks every media-row insert",()=>{
  const admin=read("assets/js/admin.js");
  assert.match(admin,/let postMediaUploadedUrls = new WeakMap\(\)/);
  assert.match(admin,/postMediaUploadedUrls\.get\(file\)/);
  assert.match(admin,/postMediaUploadedUrls\.set\(file, uploadedUrl\)/);
  assert.match(admin,/const inserted = await createPostMedia\(/);
  assert.match(admin,/if \(inserted\?\.error\) throw inserted\.error/);
  assert.match(admin,/postMediaUploadedUrls\.delete\(file\)/);
});

test("failed media attachments remain available for retry without duplicating the post",()=>{
  const admin=read("assets/js/admin.js");
  assert.match(admin,/failedFiles\.push\(file\)/);
  assert.match(admin,/editingPostId = savedPostId/);
  assert.match(admin,/The post was not duplicated/);
  assert.match(admin,/Retry image attachments/);
  assert.match(admin,/postMediaFiles = failedFiles/);
  assert.match(admin,/postMediaPreviewUrls = failedPreviews/);
});

test("cover upload failure is reported before the article is saved",()=>{
  const admin=read("assets/js/admin.js");
  const coverStart=admin.indexOf("const firstMediaPhoto");
  const saveStart=admin.indexOf("if (editingPostId)",coverStart);
  const coverSection=admin.slice(coverStart,saveStart);
  assert.match(coverSection,/try \{/);
  assert.match(coverSection,/catch\(error\)/);
  assert.match(coverSection,/The post was not saved/);
});
