const test = require("node:test");
const assert = require("node:assert/strict");
const USER = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222.webm";
const objectPath = "direct-messages/" + USER + "/" + FILE;
const root = "https://project.supabase.co/storage/v1/object/sign/chat-media/";

test("extract permanent chat media path without retaining the token", async () => {
  const { getChatMediaPath } = await import("../assets/js/chat-media-path.mjs");
  assert.equal(getChatMediaPath(root + objectPath + "?token=short-lived"), objectPath);
  assert.equal(getChatMediaPath(root + objectPath + "?token=x&download=1"), objectPath);
});

test("reject unrelated/public media and invalid private paths", async () => {
  const { getChatMediaPath } = await import("../assets/js/chat-media-path.mjs");
  for (const value of [
    "", "javascript:alert(1)",
    "https://project.supabase.co/storage/v1/object/public/media/" + objectPath,
    "https://project.supabase.co/storage/v1/object/sign/media/" + objectPath,
    root + "direct-messages/" + USER + "/%2E%2E/other.png",
    root + "direct-messages/" + USER + "/%2Funsafe",
    root + "direct-messages/other/" + FILE
  ]) assert.equal(getChatMediaPath(value), "", value);
});
