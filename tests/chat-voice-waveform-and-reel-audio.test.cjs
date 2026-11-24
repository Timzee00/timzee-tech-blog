const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const reels = fs.readFileSync("video.html", "utf8");
const recorder = fs.readFileSync("assets/js/chat-v2.js", "utf8");
const voicePlayer = fs.readFileSync("assets/js/chat-voice-player.mjs", "utf8");
const chatCss = fs.readFileSync("assets/css/chat-fixes.css", "utf8");

test("Reels recover audio after autoplay fallback on an explicit viewer tap", () => {
  assert.match(reels, /if\(vid\.muted \|\| state\.sessionMuted\)/);
  assert.match(reels, /sessionStorage\.setItem\("timzee:reels-muted","false"\)/);
  assert.match(reels, /document\.querySelectorAll\("\.reel-video"\)\.forEach\(video=>\{video\.muted=false;\}\)/);
  assert.match(reels, /Do not persist an autoplay-policy rejection as the viewer's mute choice/);
});

test("voice recording waveform follows microphone amplitude instead of a synthetic animation", () => {
  assert.match(recorder, /createAnalyser\(\)/);
  assert.match(recorder, /createMediaStreamSource\(stream\)\.connect\(state\.analyser\)/);
  assert.match(recorder, /getByteTimeDomainData\(samples\)/);
  assert.doesNotMatch(recorder, /Math\.sin\(Date\.now\(\)\/180/);
});

test("voice-note playback waveform is decoded from the actual audio and loaded lazily", () => {
  assert.match(voicePlayer, /decodeAudioData\(bytes\.slice\(0\)\)/);
  assert.match(voicePlayer, /getChannelData\(0\)/);
  assert.match(voicePlayer, /new IntersectionObserver/);
  assert.match(voicePlayer, /waveformBars=40/);
});

test("voice notes keep a normal readable width on mobile and desktop", () => {
  assert.match(chatCss, /\.chat-page \.voice-player\{box-sizing:border-box;width:100%/);
  assert.match(chatCss, /\.chat-message:has\(\.voice-player\)\{width:min\(420px,92%\)/);
  assert.match(chatCss, /\.chat-page \.chat-message \.voice-player\{width:100%!important;max-width:100%!important\}/);
});
