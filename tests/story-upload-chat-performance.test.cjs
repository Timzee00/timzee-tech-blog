const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const read=path=>readFileSync(resolve(__dirname,'..',path),'utf8');

test('Story composer exposes functional video editing and retains failed upload drafts',()=>{
  const html=read('stories.html');
  assert.match(html,/id="storyEditVideo"/);
  assert.match(html,/import \{editStatusVideo\} from "\.\/assets\/js\/story-video-editor\.mjs"/);
  assert.match(html,/await editStatusVideo\(original\)/);
  assert.match(html,/editedStoryFile=edited/);
  assert.match(html,/editedStoryFile \|\| fileInput\.files\?\.\[0\]/);
  assert.match(html,/if\(navigator\.onLine===false\)/);
  assert.match(html,/submitBtn\.textContent = "Post Story"/);
  assert.match(html,/if \(result\.error\) \{/);
});

test('Video editing really exports a media file on device, never sends it to other services',()=>{
  const js=read('assets/js/story-video-editor.mjs');
  assert.match(js,/export async function editStatusVideo\(file\)/);
  assert.match(js,/MediaRecorder\.isTypeSupported/);
  assert.match(js,/canvas\.captureStream\(24\)/);
  assert.match(js,/new MediaRecorder\(stream/);
  assert.match(js,/q\("start"\)/);
  assert.match(js,/q\("end"\)/);
  assert.match(js,/q\("mute"\)/);
  assert.match(js,/new File\(\[blob\]/);
  assert.match(js,/MAX_STORY_BYTES = 50 \* 1024 \* 1024/);
  assert.doesNotMatch(js,/fetch\(|https:\/\//);
});

test('Interrupted publish never deletes media on an ambiguous network response',()=>{
  const js=read('assets/js/stories.js');
  assert.match(js,/let stage="uploading your status"/);
  assert.match(js,/stage="publishing your status"/);
  assert.match(js,/stage!=="publishing your status"\|\|!networkFailure/);
  assert.match(js,/check My Stories before retrying/);
  assert.match(js,/cleanupFailedStoryUploads\(uploaded,userId\)/);
});

test('Chat paints after independent core requests and defers the preview waterfall',()=>{
  const js=read('assets/js/chat-v2.js');
  assert.match(js,/async function loadAllChatData\(\{deferPreviews=false\}=\{\}\)/);
  assert.match(js,/const \[saved,fr,gr,history\]=await Promise\.all\(/);
  assert.match(js,/if\(deferPreviews\)\{/);
  assert.match(js,/void Promise\.all\(\[profiles,previewRequest\]\)/);
  assert.match(js,/state\.previewsLoading=false/);
  assert.match(js,/generation!==state\.chatListGeneration/);
  assert.match(js,/await loadAllChatData\(\{deferPreviews:true\}\)/);
  assert.match(js,/Loading latest message…/);
  assert.match(js,/const \[verifiedResult,preferences,staffPermission\]=await Promise\.all\(/);
});
