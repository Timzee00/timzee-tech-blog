// Accessible and compact playback for sent and unsent voice previews.
export function setupChatVoicePlayers(){
  const fmt=seconds=>{
    const value=Math.max(0,Math.floor(Number(seconds)||0));
    return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
  };
  const playerFor=e=>e.target.closest('.voice-player');
  document.addEventListener('click',async e=>{
    const play=e.target.closest('.voice-player-play');
    const speed=e.target.closest('.voice-player-speed');
    if(play){
      const player=play.closest('.voice-player'),audio=player?.querySelector('audio');
      if(!audio)return;
      if(!audio.paused){audio.pause();return;}
      document.querySelectorAll('.voice-player audio').forEach(other=>{if(other!==audio)other.pause();});
      try{await audio.play();}catch{play.textContent='▶';window.siteToast?.('Audio could not be played. Try again.',{type:'error'});}
    }else if(speed){
      const audio=speed.closest('.voice-player')?.querySelector('audio');
      if(!audio)return;
      const rates=[1,1.5,2],current=rates.indexOf(audio.playbackRate);
      audio.playbackRate=rates[(current+1)%rates.length];
      speed.textContent=audio.playbackRate+'×';
    }
  });
  document.addEventListener('input',e=>{
    if(!e.target.matches('.voice-player-seek'))return;
    const audio=e.target.closest('.voice-player')?.querySelector('audio');
    if(audio&&Number.isFinite(audio.duration)&&audio.duration>0){
      audio.currentTime=audio.duration*Number(e.target.value)/100;
    }
  });
  const sync=e=>{
    const player=playerFor(e);if(!player)return;
    const audio=e.target;
    const duration=Number.isFinite(audio.duration)?audio.duration:0;
    const seek=player.querySelector('.voice-player-seek');
    const label=player.querySelector('.voice-player-time');
    const play=player.querySelector('.voice-player-play');
    if(seek)seek.value=duration?String(Math.min(100,Math.round(audio.currentTime*100/duration))):'0';
    if(label)label.textContent=fmt(audio.currentTime)+' / '+fmt(duration);
    if(play)play.textContent=audio.paused?'▶':'❚❚';
    if(play)play.setAttribute('aria-label',audio.paused?'Play voice note':'Pause voice note');
  };
  ['timeupdate','loadedmetadata','play','pause','ended'].forEach(name=>
    document.addEventListener(name,e=>{if(e.target.matches('.voice-player audio'))sync(e);},true));
}
export function voicePlayerHtml(url){
  return `<div class="voice-player">
   <button type="button" class="voice-player-play" aria-label="Play voice note">▶</button>
   <div class="voice-player-controls">
      <div class="voice-preview-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <input class="voice-player-seek" type="range" min="0" max="100" value="0" aria-label="Seek in voice note">
      <span class="voice-player-time">0:00 / 0:00</span>
   </div>
   <button type="button" class="voice-player-speed" aria-label="Change playback speed">1×</button>
   <audio preload="metadata" src="${url}"></audio>
  </div>`;
}
