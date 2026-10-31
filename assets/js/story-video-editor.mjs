/* Native, on-device Story video editor. No third-party upload or heavy wasm.
 * Trim and optionally mute a short clip; video is re-encoded in real time.
 * The original File remains untouched until the user chooses "Use video".
 */
const MAX_CLIP_SECONDS = 30;
const MAX_STORY_BYTES = 50 * 1024 * 1024;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const clock = seconds => {
  const n = Math.max(0, Math.floor(seconds));
  return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
};
const supportedContainer = () => {
  const types = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4"
  ];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || "";
};

export async function editStatusVideo(file) {
  if (!file?.type?.startsWith("video/")) throw Error("Choose a video to edit first.");
  if (!("MediaRecorder" in window) || !HTMLCanvasElement.prototype.captureStream)
    throw Error("This browser cannot export edited video. Try an updated Chrome or another supported browser.");

  const modal = document.createElement("dialog");
  modal.className = "status-video-editor";
  modal.setAttribute("aria-label", "Edit status video");
  modal.innerHTML = `<div class="status-video-editor-inner">
    <header><strong>Edit video</strong><button type="button" data-cancel aria-label="Close video editor">×</button></header>
    <video data-preview controls playsinline preload="metadata" aria-label="Selected video preview"></video>
    <div class="status-video-editor-times">
      <label>Start <input type="range" data-start min="0" step="0.25" value="0"><output data-start-label>0:00</output></label>
      <label>End <input type="range" data-end min="0" step="0.25" value="0"><output data-end-label>0:00</output></label>
    </div>
    <label class="status-video-editor-mute"><input type="checkbox" data-mute> Mute the video</label>
    <p class="status-video-editor-hint">Trim up to 30 seconds. Export runs on your device, so the preview plays while it saves. Your original stays unchanged.</p>
    <p data-status role="status" aria-live="polite">Loading video…</p>
    <footer><button type="button" data-cancel>Cancel</button><button type="button" data-save disabled>Use edited video</button></footer>
  </div>`;
  document.body.appendChild(modal);

  const q = key => modal.querySelector("[data-" + key + "]");
  const video = q("preview");
  const videoUrl = URL.createObjectURL(file);
  video.src = videoUrl;
  video.muted = true;
  let duration = 0, exporting = false, completed = false, aborted = false;
  let recorder = null, stream = null, audioContext = null, timer = 0, frame = 0;
  let currentCanvas = null;
  let resolveResult;
  const result = new Promise(resolve => { resolveResult = resolve; });
  const status = value => { q("status").textContent = value; };

  const releaseExport = () => {
    clearInterval(timer); timer = 0;
    cancelAnimationFrame(frame); frame = 0;
    stream?.getTracks().forEach(track => track.stop());
    stream = null; recorder = null; currentCanvas = null;
    if (audioContext) { void audioContext.close().catch(() => {}); audioContext = null; }
  };
  const finish = output => {
    if (completed) return;
    completed = true; aborted = true;
    try { video.pause(); recorder?.stop(); } catch {}
    releaseExport();
    video.removeAttribute("src"); video.load();
    URL.revokeObjectURL(videoUrl);
    if (modal.open) modal.close();
    modal.remove(); resolveResult(output);
  };

  const updateRanges = changed => {
    if (!duration) return;
    const start = q("start"), end = q("end");
    let a = clamp(start.value, 0, Math.max(0, duration - 0.25));
    let b = clamp(end.value, 0.25, duration);
    if (changed === "start" && a >= b) b = Math.min(duration, a + 0.25);
    if (changed === "end" && b <= a) a = Math.max(0, b - 0.25);
    if (b - a > MAX_CLIP_SECONDS) {
      if (changed === "start") b = Math.min(duration, a + MAX_CLIP_SECONDS);
      else a = Math.max(0, b - MAX_CLIP_SECONDS);
    }
    start.value = String(a); end.value = String(b);
    q("start-label").textContent = clock(a);
    q("end-label").textContent = clock(b);
    if (!exporting && Number.isFinite(a)) {
      video.pause(); video.currentTime = a;
    }
  };
  const markLoaded = () => {
    duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0.25) {
      status("This video has no readable duration. Choose another video."); return;
    }
    q("start").max = String(Math.max(0, duration - 0.25));
    q("end").max = String(duration);
    q("end").value = String(Math.min(duration, MAX_CLIP_SECONDS));
    q("save").disabled = false;
    updateRanges("start");
    status("Ready to edit. Move the sliders to select your clip.");
  };

  video.addEventListener("loadedmetadata", markLoaded, { once: true });
  video.addEventListener("error", () => {
    if (!completed && !exporting) status("Could not read this video. Try MP4 or WebM.");
  });
  video.addEventListener("timeupdate", () => {
    if (!exporting && duration && video.currentTime >= Number(q("end").value))
      video.pause();
  });
  q("start").addEventListener("input", () => updateRanges("start"));
  q("end").addEventListener("input", () => updateRanges("end"));
  q("mute").addEventListener("change", () => { video.muted = q("mute").checked; });
  modal.querySelectorAll("[data-cancel]").forEach(button =>
    button.addEventListener("click", () => finish(null)));
  modal.addEventListener("cancel", event => { event.preventDefault(); finish(null); });

  q("save").addEventListener("click", async () => {
    if (!duration || exporting || completed) return;
    const start = Number(q("start").value), end = Number(q("end").value);
    if (!(end > start && end - start <= MAX_CLIP_SECONDS + 0.01)) {
      status("Choose a valid clip of 30 seconds or less."); return;
    }
    const format = supportedContainer();
    if (!format) { status("Video export is not available on this browser."); return; }
    exporting = true; aborted = false; q("save").disabled = true;
    modal.querySelectorAll("input").forEach(input => { input.disabled = true; });
    status("Preparing your edited video…");
    try {
      video.pause();
      if (video.seeking || Math.abs(video.currentTime - start) > 0.04) {
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeout);
            video.removeEventListener("seeked", ready);
            video.removeEventListener("error", failed);
          };
          const ready = () => { cleanup(); resolve(); };
          const failed = () => { cleanup(); reject(Error("Video cannot seek to that position.")); };
          const timeout = setTimeout(() => {
            cleanup(); reject(Error("Video seeking timed out."));
          }, 12000);
          video.addEventListener("seeked", ready);
          video.addEventListener("error", failed, { once: true });
          try { video.currentTime = start; } catch (error) { cleanup(); reject(error); }
          if (!video.seeking && Math.abs(video.currentTime - start) <= 0.04)
            ready();
        });
      }
      if (completed) return;
      const canvas = document.createElement("canvas");
      const rawWidth = video.videoWidth || 720, rawHeight = video.videoHeight || 1280;
      const scale = Math.min(1, 720 / Math.max(rawWidth, rawHeight));
      canvas.width = Math.max(2, (Math.round(rawWidth * scale / 2) * 2));
      canvas.height = Math.max(2, (Math.round(rawHeight * scale / 2) * 2));
      currentCanvas = canvas;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw Error("Video editor cannot initialize on this device.");
      stream = canvas.captureStream(24);
      // Capture soundtrack locally; skip this expensive audio path for muted clips.
      if (!q("mute").checked) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) throw Error("Audio export is unsupported here. Select Mute video and retry.");
        audioContext = new AudioCtor();
        const mediaSource = audioContext.createMediaElementSource(video);
        const destination = audioContext.createMediaStreamDestination();
        mediaSource.connect(destination);
        destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
        await audioContext.resume();
        video.muted = false;
      } else video.muted = true;

      const chunks = [];
      recorder = new MediaRecorder(stream, {
        mimeType: format, videoBitsPerSecond: 1_600_000, audioBitsPerSecond: 96_000
      });
      recorder.addEventListener("dataavailable", event => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener("error", event => {
        status("Video export failed. Please try a shorter selection.");
        console.warn("Story video recording error", event.error || event);
      });
      recorder.addEventListener("stop", () => {
        if (completed || aborted) { releaseExport(); return; }
        const kind = recorder?.mimeType || format;
        const type = kind.split(";")[0];
        const blob = new Blob(chunks, { type });
        releaseExport();
        if (!blob.size || blob.size > MAX_STORY_BYTES) {
          exporting = false; q("save").disabled = false;
          modal.querySelectorAll("input").forEach(input => { input.disabled = false; });
          status(blob.size ? "Edited clip is over 50 MB. Choose a shorter section." : "Nothing was recorded. Try again.");
          return;
        }
        const extension = type === "video/mp4" ? ".mp4" : ".webm";
        finish(new File([blob], "blipmood-story-" + Date.now() + extension, { type }));
      });
      const draw = () => {
        if (completed || !exporting) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frame = requestAnimationFrame(draw);
      };
      draw();
      recorder.start(300);
      await video.play();
      timer = setInterval(() => {
        if (completed || !recorder || recorder.state === "inactive") return;
        status("Exporting " + clock(Math.min(end - start, Math.max(0, video.currentTime - start))) +
          " / " + clock(end - start) + "… Keep the editor open.");
        if (video.ended || video.currentTime >= end - 0.065) {
          video.pause(); recorder.stop(); clearInterval(timer); timer = 0;
        }
      }, 100);
    } catch (error) {
      if (completed) return;
      aborted = true; video.pause();
      try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch {}
      releaseExport(); exporting = false; q("save").disabled = false;
      modal.querySelectorAll("input").forEach(input => { input.disabled = false; });
      status(error.message || "Unable to export this video on your device.");
    }
  });
  if (!modal.showModal) { finish(null); throw Error("Video editing is not supported by this browser."); }
  modal.showModal();
  if (video.readyState >= 1) markLoaded();
  return result;
}
