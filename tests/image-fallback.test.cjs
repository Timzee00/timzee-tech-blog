const test = require("node:test");
const assert = require("node:assert/strict");
test("avatar failures use a local avatar illustration; articles and ads a media fallback", async () => {
  const { fallbackImagePath } = await import("../assets/js/image-fallback.js");
  assert.equal(fallbackImagePath({ className: "chat-member-avatar" }), "/assets/img/avatar-placeholder.svg");
  assert.equal(fallbackImagePath({ id: "sellerAvatar" }), "/assets/img/avatar-placeholder.svg");
  assert.equal(fallbackImagePath({ className: "popular-media" }), "/assets/img/media-placeholder.svg");
  assert.equal(fallbackImagePath({ className: "ad-image" }), "/assets/img/media-placeholder.svg");
});
