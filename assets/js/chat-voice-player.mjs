// Accessible and compact playback for sent and unsent voice previews.
export function setupChatVoicePlayers(){
  const fmt=seconds=>{
    const value=Math.max(0,Math.floor(Number(seconds)||0));
    return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
  };
  const playerFor=e=>e.target.closest('.voice-player');
  const waveformCache=new Map();
  const waveformBars=40;
  async function loadWaveform(player){
    const audio=player?.querySelector('audio');
    const host=player?.querySelector('.voice-preview-bars');
    if(!audio||!host||host.dataset.loaded==='true'||host.dataset.loading==='true')return;
    const src=audio.currentSrc||audio.src;
    if(!src)return;
    host.dataset.loading='true';
    try{
      let levels=waveformCache.get(src);
      if(!levels){
        const response=await fetch(src,{mode:'cors'});
        if(!response.ok)throw new Error('Waveform source unavailable');
        const bytes=await response.arrayBuffer();
        const Context=window.AudioContext||window.webkitAudioContext;
        if(!Context)throw new Error('Audio decoding unavailable');
        const context=new Context();
        try{
          const decoded=await context.decodeAudioData(bytes.slice(0));
          const channel=decoded.getChannelData(0);
          const step=Math.max(1,Math.floor(channel.length/waveformBars));
          levels=Array.from({length:waveformBars},(_,index)=>{
            const start=index*step,end=Math.min(channel.length,start+step);
            let sum=0;for(let i=start;i<end;i++)sum+=channel[i]*channel[i];
            return Math.max(.08,Math.sqrt(sum/Math.max(1,end-start)));
          });
          waveformCache.set(src,levels);
        }finally{await context.close().catch(()=>{});}
      }
      host.innerHTML=levels.map(level=>'<i style="--wave-level:'+Math.round(level*100)+'%"></i>').join('');
      host.dataset.loaded='true';
    }catch(error){host.dataset.fallback='true';}
    finally{host.dataset.loading='false';}
  }
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
    if(audio.readyState>=1)void loadWaveform(player);
    const play=player.querySelector('.voice-player-play');
    if(seek)seek.value=duration?String(Math.min(100,Math.round(audio.currentTime*100/duration))):'0';
    if(label)label.textContent=fmt(audio.currentTime)+' / '+fmt(duration);
    if(play)play.textContent=audio.paused?'▶':'❚❚';
    if(play)play.setAttribute('aria-label',audio.paused?'Play voice note':'Pause voice note');
  };
  document.querySelectorAll('.voice-player').forEach(player=>void loadWaveform(player));
  const waveformObserver=new MutationObserver(records=>{
    records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType!==1)return;
      if(node.matches?.('.voice-player'))void loadWaveform(node);
      node.querySelectorAll?.('.voice-player').forEach(player=>void loadWaveform(player));
    }));
  });
  waveformObserver.observe(document.body,{childList:true,subtree:true});
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
