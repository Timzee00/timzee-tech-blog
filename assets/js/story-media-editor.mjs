// Local photo edits: no upload until the member publishes the edited file.
export async function editStatusPhoto(file,{verified=false}={}){
 if(!file?.type?.startsWith("image/"))throw Error("Choose an image first.");
 const image=await createImageBitmap(file);
 const dialog=document.createElement("dialog");
 dialog.className="status-photo-editor";
 dialog.innerHTML=`<div class="status-photo-editor-inner">
 <header><strong>Edit photo</strong><button type="button" data-cancel aria-label="Close">×</button></header>
 <canvas aria-label="Photo editing canvas"></canvas>
 <div class="status-photo-editor-tools">
 <label>Crop <select data-crop><option value="0">Original</option><option value="0.5625">Story 9:16</option><option value="1">Square</option><option value="0.8">Portrait 4:5</option></select></label>
 <button type="button" data-rotate>Rotate ↻</button>
 <label>Brightness <input data-bright type="range" min="50" max="150" value="100"></label>
 <label>Contrast <input data-contrast type="range" min="50" max="150" value="100"></label>
 <label>Colour <input data-saturation type="range" min="0" max="200" value="100"></label>
 <label>Text / emoji <input data-text maxlength="100" placeholder="Your words ✨"></label>
 <label>Text colour <input data-colour type="color" value="#ffffff"></label>
 <label>Text position <input data-position type="range" min="12" max="88" value="65"></label>
 <label><input type="checkbox" data-draw> Draw with finger</label>
 <button type="button" data-undo>Undo drawing</button>
 </div><footer><button type="button" data-cancel>Cancel</button><button type="button" data-save>Use photo</button></footer>
 <p data-status role="status" aria-live="polite">Changes remain on your device until you post.</p></div>`;
 document.body.appendChild(dialog);
 const c=dialog.querySelector("canvas"),ctx=c.getContext("2d");
 const q=k=>dialog.querySelector("[data-"+k+"]");
 const state={angle:0,crop:0,bright:100,contrast:100,saturation:100,text:"",colour:"#ffffff",position:65,strokes:[]};
 const render=()=>{
   const turning=state.angle%180!==0,sw=turning?image.height:image.width,sh=turning?image.width:image.height;
   const ratio=state.crop||sw/sh;
   let w=sw,h=sh;if(w/h>ratio)w=h*ratio;else h=w/ratio;
   const scale=Math.min(1,(verified?1920:1440)/Math.max(w,h));
   c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));
   ctx.save();ctx.fillStyle="#101820";ctx.fillRect(0,0,c.width,c.height);
   ctx.translate(c.width/2,c.height/2);ctx.rotate(state.angle*Math.PI/180);
   const fit=Math.max(c.width/sw,c.height/sh);
   ctx.filter=`brightness(${state.bright}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`;
   ctx.drawImage(image,-image.width*fit/2,-image.height*fit/2,image.width*fit,image.height*fit);
   ctx.restore();
   for(const stroke of state.strokes){
     ctx.beginPath();ctx.strokeStyle="#ffcf38";ctx.lineWidth=Math.max(3,c.width/140);ctx.lineCap="round";
     stroke.forEach((p,i)=>{if(i)ctx.lineTo(p[0]*c.width,p[1]*c.height);else ctx.moveTo(p[0]*c.width,p[1]*c.height);});ctx.stroke();
   }
   if(state.text.trim()){
     const size=Math.max(20,Math.round(c.width/12));
     ctx.font=`bold ${size}px system-ui`;ctx.textAlign="center";ctx.textBaseline="middle";
     ctx.strokeStyle="#000000";ctx.lineWidth=Math.max(3,size/13);ctx.fillStyle=state.colour;
     const label=state.text.trim().slice(0,100),x=c.width/2,y=c.height*state.position/100;
     ctx.strokeText(label,x,y,c.width*.9);ctx.fillText(label,x,y,c.width*.9);
   }
 };
 const changes=[["crop","crop",Number],["bright","bright",Number],["contrast","contrast",Number],
 ["saturation","saturation",Number],["text","text",String],["colour","colour",String],["position","position",Number]];
 for(const [control,property,cast] of changes)q(control).addEventListener("input",e=>{
   state[property]=cast(e.target.value);render();
 });
 q("rotate").onclick=()=>{state.angle=(state.angle+90)%360;render();};
 q("undo").onclick=()=>{state.strokes.pop();render();};
 let drawing=null;
 const pos=e=>{const rect=c.getBoundingClientRect();return [
   Math.min(1,Math.max(0,(e.clientX-rect.left)/rect.width)),
   Math.min(1,Math.max(0,(e.clientY-rect.top)/rect.height))];};
 c.addEventListener("pointerdown",e=>{
   if(!q("draw").checked)return;
   e.preventDefault();drawing=[pos(e)];state.strokes.push(drawing);c.setPointerCapture(e.pointerId);
 });
 c.addEventListener("pointermove",e=>{if(!drawing)return;drawing.push(pos(e));render();});
 c.addEventListener("pointerup",()=>{drawing=null;});c.addEventListener("pointercancel",()=>{drawing=null;});
 render();
 return new Promise(resolve=>{
   let ended=false;const done=file=>{if(ended)return;ended=true;dialog.close();image.close?.();dialog.remove();resolve(file);};
   dialog.querySelectorAll("[data-cancel]").forEach(btn=>btn.onclick=()=>done(null));
   dialog.addEventListener("cancel",e=>{e.preventDefault();done(null);});
   q("save").onclick=async()=>{
     q("save").disabled=true;q("status").textContent="Exporting photo…";
     try{
       render();const blob=await new Promise((ok,fail)=>c.toBlob(b=>b?ok(b):fail(Error("Export failed")),"image/jpeg",.9));
       done(new File([blob],"story-edited-"+Date.now()+".jpg",{type:"image/jpeg"}));
     }catch(e){q("status").textContent=e.message;q("save").disabled=false;}
   };
   dialog.showModal();
 });
}
