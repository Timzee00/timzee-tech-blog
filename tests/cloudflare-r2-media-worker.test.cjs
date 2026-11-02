const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { URL } = require("node:url");

const root = require("node:path").resolve(__dirname, "..");
const read = (p) => fs.readFileSync(require("node:path").join(root, p), "utf8");
const source = read("cloudflare/blipmood-media/src/index.js");

function workerHarness({originBytes = new TextEncoder().encode("VIDEO-DATA"), contentType = "video/mp4"} = {}) {
  let requests = 0;
  const saved = new Map();
  const storage = {
    async head(key) {
      const item = saved.get(key);
      return item ? { size: item.bytes.length, httpMetadata: { contentType: item.type } } : null;
    },
    async get(key, opts) {
      const item = saved.get(key);
      if (!item) return null;
      const bytes = opts?.range
        ? item.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length)
        : item.bytes;
      return {
        body: bytes, size: item.bytes.length, httpMetadata: { contentType: item.type },
      };
    },
    async put(key, bytes, opts) {
      saved.set(key, { bytes: new Uint8Array(bytes), type: opts.httpMetadata.contentType });
    },
  };
  const upstream = async (url, init) => {
    requests += 1;
    assert.match(url, /^https:\/\/duvbcwwprkzzyzikmcol\.supabase\.co\/storage\/v1\/object\/public\/media\//);
    const headers = { "content-type": contentType, "content-length": String(originBytes.length) };
    return new Response(init.method === "HEAD" ? null : originBytes, { status: 200, headers });
  };
  const sandbox = { Response, Request, Headers, URL, Uint8Array, console, fetch: upstream };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source.replace(/export default\s*\{/, "globalThis.worker = {"), sandbox, { timeout: 1000 });
  const request = (pathname, { method = "GET", headers = {} } = {}) =>
    sandbox.worker.fetch(new Request("https://blipmood-public-media.example.workers.dev" + pathname, {
      method, headers
    }), { MEDIA_BUCKET: storage });
  return { request, storage, saved, getOriginRequests: () => requests };
}
test("read-through cache imports public video once and serves it from R2 on replay", async () => {
  const h = workerHarness();
  const path = "/media/videos/owner/clip.mp4";
  const first = await h.request(path);
  assert.equal(first.status, 200);
  assert.equal(await first.text(), "VIDEO-DATA");
  const second = await h.request(path);
  assert.equal(second.status, 200);
  assert.equal(await second.text(), "VIDEO-DATA");
  assert.equal(h.getOriginRequests(), 1);
  assert.equal(h.saved.size, 1);
});
test("R2 cached video supports byte ranges, HEAD and unsatisfiable ranges", async () => {
  const h = workerHarness();
  const path = "/media/videos/owner/clip.mp4";
  await h.request(path);
  const part = await h.request(path, { headers: { range: "bytes=0-4" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 0-4/10");
  assert.equal(await part.text(), "VIDEO");
  const head = await h.request(path, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  const invalid = await h.request(path, { headers: { range: "bytes=999-" } });
  assert.equal(invalid.status, 416);
  assert.equal(h.getOriginRequests(), 1);
});
test("rejects private, expiring, malformed, query and non-read media paths", async () => {
  const h = workerHarness();
  const paths = [
    "/media/stories/user/status.jpg",
    "/media/chat-media/owner/photo.jpg",
    "/media/story-private-media/owner/private.mp4",
    "/media/videos/../secret.mp4",
    "/media/videos/notafile",
    "/api/private",
  ];
  for (const path of paths) {
    const response = await h.request(path);
    assert.notEqual(response.status, 200, path);
  }
  assert.equal((await h.request("/media/videos/owner/x.mp4?token=private")).status, 400);
  assert.equal((await h.request("/media/videos/owner/x.mp4", { method: "POST" })).status, 405);
  assert.equal(h.getOriginRequests(), 0);
});
test("large media deliberately redirects instead of buffering unbounded payloads", async () => {
  const data = new Uint8Array(25 * 1024 * 1024);
  const h = workerHarness({ originBytes: data });
  const response = await h.request("/media/videos/owner/big.mp4");
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location"), /^https:\/\/duvbcwwprkzzyzikmcol\.supabase\.co\//);
  assert.equal(h.saved.size, 0);
});
test("URL router is off by default and only permits public Supabase media", async () => {
  const code = read("assets/js/media-delivery.mjs");
  assert.match(code, /const WORKER_ENABLED_BY_DEFAULT = false;/);
  assert.match(code, /PUBLIC_ORIGIN/);
  assert.match(code, /!PUBLIC_FOLDERS\.has\(key\.split\("\/"\)\[0\]\)/);
  assert.match(code, /!u\.pathname\.startsWith\(PUBLIC_STORAGE_PREFIX\)/);
  const module = await import("data:text/javascript," + encodeURIComponent(code));
  const legacy = "https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/videos/user/x.mp4";
  assert.equal(module.deliveryMediaUrl(legacy), legacy);
  assert.equal(module.deliveryMediaUrl("story-private-media/user/photo.jpg"), "story-private-media/user/photo.jpg");
});
