const test = require("node:test");
const assert = require("node:assert/strict");

let formatters;
test.before(async () => {
  formatters = await import("../assets/js/chat/formatters.mjs");
});

test("normalizes timezone-less Postgres timestamps as UTC", () => {
  assert.equal(formatters.asUtcTimestamp("2026-11-16 10:30:00"), "2026-11-16T10:30:00Z");
  assert.equal(formatters.asUtcTimestamp("2026-11-16T10:30:00Z"), "2026-11-16T10:30:00Z");
  assert.equal(formatters.asUtcTimestamp("2026-11-16T10:30:00+01:00"), "2026-11-16T10:30:00+01:00");
  assert.equal(formatters.asUtcTimestamp(""), "");
  assert.equal(formatters.asUtcTimestamp(null), "");
});

test("extracts extensions after query strings and fragments", () => {
  assert.equal(formatters.getFileExtension("https://cdn.test/photo.WEBP?width=200#preview"), "webp");
  assert.equal(formatters.getFileExtension("archive"), "");
  assert.equal(formatters.getFileExtension("folder/file.tar.gz"), "gz");
});

test("maps MIME types to attachment categories", () => {
  assert.equal(formatters.getMediaTypeFromMime("image/avif"), "image");
  assert.equal(formatters.getMediaTypeFromMime("video/mp4"), "video");
  assert.equal(formatters.getMediaTypeFromMime("audio/ogg"), "audio");
  assert.equal(formatters.getMediaTypeFromMime("application/pdf"), "file");
  assert.equal(formatters.getMediaTypeFromMime(""), "");
});

test("resolves attachment type by explicit type, MIME, then extension", () => {
  assert.equal(formatters.resolveAttachmentType({ mediaType: "image", mimeType: "video/mp4" }), "image");
  assert.equal(formatters.resolveAttachmentType({ mimeType: "video/mp4", fileName: "photo.jpg" }), "video");
  assert.equal(formatters.resolveAttachmentType({ fileName: "clip.MOV" }), "video");
  assert.equal(formatters.resolveAttachmentType({ mediaUrl: "voice.opus" }), "audio");
  assert.equal(formatters.resolveAttachmentType({ fileName: "document.pdf" }), "file");
});

test("formats file sizes and rejects invalid values", () => {
  assert.equal(formatters.formatFileSize(512), "512 B");
  assert.equal(formatters.formatFileSize(1024), "1.0 KB");
  assert.equal(formatters.formatFileSize(1024 * 1024), "1.0 MB");
  assert.equal(formatters.formatFileSize(0), "");
  assert.equal(formatters.formatFileSize(-1), "");
  assert.equal(formatters.formatFileSize(Number.NaN), "");
});

test("decodes attachment names and tolerates malformed URI escapes", () => {
  assert.equal(formatters.getDisplayFileName("https://cdn.test/hello%20world.png?x=1"), "hello world.png");
  assert.equal(formatters.getDisplayFileName("folder/%E0%A4%A"), "%E0%A4%A");
  assert.equal(formatters.getDisplayFileName(""), "Attachment");
});

test("formats recorder durations", () => {
  assert.equal(formatters.formatDuration(0), "0:00");
  assert.equal(formatters.formatDuration(59999), "0:59");
  assert.equal(formatters.formatDuration(60000), "1:00");
  assert.equal(formatters.formatDuration(125000), "2:05");
  assert.equal(formatters.formatDuration(-1000), "0:00");
});
