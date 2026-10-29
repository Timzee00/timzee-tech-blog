// Blipmood Profile FX 1.0 — light, bounded, cover-aware particle engine.
// Visual choices are presentation only. No verification or identity authority is attached.
export const FX_EFFECTS=Object.freeze([
 ["none","None","Keep my photos natural","#6ee7d4"],
 ["storm","Storm","Electric trails and gentle rain","#8fcbff"],
 ["inferno","Inferno","Floating warm embers","#ff9956"],
 ["glitch","Glitch","Digital fragments and cyber sparks","#41ebdc"],
 ["frost","Frost","Snow crystals and cold mist","#b8ebff"],
 ["void","Void","Quiet cosmic gravity","#a78bfa"],
 ["sakura","Sakura","Drifting flower petals","#ffadcc"],
 ["aurora","Aurora","Northern lights on your cover","#70e3d6"],
 ["stardust","Stardust","Gold comets and tiny constellations","#ffe09b"],
 ["hearts","Hearts","Soft floating hearts","#ff90be"],
 ["fireflies","Fireflies","Gentle wandering lights","#dcff8f"],
 ["neon","Neon Pulse","Clean futuristic glow","#2aecd5"],
 ["halo","Royal Halo","A refined circular light crown","#e4c67a"],
 ["eclipse","Solar Eclipse","Deep celestial energy","#b0a1ff"],
 ["diamond","Diamond Dust","Precise luminous crystals","#c7f2ff"]
].map(([id,title,description,color])=>Object.freeze({id,title,description,color})));
const COLORS=Object.freeze(Object.fromEntries(FX_EFFECTS.map(e=>[e.id,e.color])));
const ALLOWED=new Set(FX_EFFECTS.map(e=>e.id));
export const DEFAULT_FX=Object.freeze({cover_effect:"none",avatar_effect:"none",intensity:45,enabled:true});
export const safeFxRadius=(value)=>Number.isFinite(value)?Math.max(0,Math.min(120,value)):0;
export function normalizeFx(raw={}){
 const pick=value=>ALLOWED.has(value)?value:"none";
 const intensity=Number(raw?.intensity);
 return {
  cover_effect:pick(raw?.cover_effect),
  avatar_effect:pick(raw?.avatar_effect),
  intensity:Number.isFinite(intensity)?Math.min(100,Math.max(0,Math.round(intensity))):45,
  enabled:raw?.enabled!==false
 };
}
export function createProfileFxEngine({host,canvas,avatar=null,maxParticles=64}={}){
 if(!host||!canvas||typeof canvas.getContext!=="function")return {apply(){},destroy(){}};
 let ctx=null;
 try{ctx=canvas.getContext("2d",{alpha:true,desynchronized:true});}catch{}
 if(!ctx)return {apply(){},destroy(){}};
 const motion=window.matchMedia?.("(prefers-reduced-motion: reduce)");
 let opts={...DEFAULT_FX},visible=false,raf=0,particles=[],width=1,height=1,last=0,clock=0,resizeObserver=null,intersectionObserver=null,burst=0,disposed=false;
 const lowPower=(navigator.hardwareConcurrency||4)<=4||window.innerWidth<470;
 const fps=lowPower?24:30;
 const requestedCap=Number.isFinite(maxParticles)?maxParticles:64;
 const cap=Math.min(80,Math.max(12,Math.min(requestedCap,lowPower?36:80)));
 const rand=Math.random;
 function resize(){
  if(disposed)return;
  const rect=host.getBoundingClientRect();
  width=Math.max(1,rect.width);height=Math.max(1,rect.height);
  const dpr=Math.min(window.devicePixelRatio||1,lowPower?1.25:1.5);
  const w=Math.max(1,Math.round(width*dpr)),h=Math.max(1,Math.round(height*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  ctx.setTransform(dpr,0,0,dpr,0,0);
 }
 function isReduced(){return Boolean(motion?.matches||document.documentElement.dataset.reduceMotion==="true");}
 function shouldRun(){return !disposed&&visible&&!document.hidden&&!isReduced()&&opts.enabled&&opts.cover_effect!=="none"&&opts.intensity>0;}
 function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;}
 function start(){
  if(!shouldRun()||raf)return;
  resize();raf=requestAnimationFrame(frame);
 }
 function refresh(){if(shouldRun())start();else{stop();particles=[];ctx.clearRect(0,0,width,height);}}
 function color(){return COLORS[opts.cover_effect]||"#78e4d4";}
 function add(){
  if(particles.length>=cap)return;
  const effect=opts.cover_effect, x=rand()*width,y=rand()*height;
  const centered=["stardust","halo","eclipse","void"].includes(effect);
  const angle=rand()*Math.PI*2;
  const px=centered?width*(.5+Math.cos(angle)*(.19+rand()*.31)):x;
  const py=centered?height*(.5+Math.sin(angle)*(.19+rand()*.31)):y;
  particles.push({x:px,y:py,vx:(rand()-.5)*.62,vy:(rand()-.5)*.64,size:1.5+rand()*5,
   life:0.65+rand()*2.2,max:2.85,angle:angle,phase:rand()*6.28,
   kind:effect});
 }
 function arc(x,y,r){
  const radius=safeFxRadius(r);
  if(radius<=0||!Number.isFinite(x)||!Number.isFinite(y))return false;
  ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);return true;
 }
 function spark(x,y,r){
  const s=safeFxRadius(r);if(s<=0)return;
  ctx.beginPath();ctx.moveTo(x,y-s);ctx.quadraticCurveTo(x+s*.18,y-s*.18,x+s,y);
  ctx.quadraticCurveTo(x+s*.18,y+s*.18,x,y+s);
  ctx.quadraticCurveTo(x-s*.18,y+s*.18,x-s,y);
  ctx.quadraticCurveTo(x-s*.18,y-s*.18,x,y-s);ctx.closePath();ctx.fill();
 }
 function shape(p,r){
  if(p.kind==="sakura"||p.kind==="diamond"||p.kind==="glitch"){
   ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle+clock*.25);
   if(p.kind==="glitch")ctx.fillRect(-r,-r/4,2*r,r*.45);
   else if(p.kind==="diamond"){ctx.beginPath();ctx.moveTo(0,-r);ctx.lineTo(r*.62,0);ctx.lineTo(0,r);ctx.lineTo(-r*.62,0);ctx.fill();}
   else{ctx.beginPath();ctx.ellipse(0,0,safeFxRadius(r),safeFxRadius(r*.53),0,0,Math.PI*2);ctx.fill();}
   ctx.restore();return;
  }
  if(p.kind==="hearts"){
   ctx.save();ctx.translate(p.x,p.y);ctx.beginPath();ctx.moveTo(0,r*.65);
   ctx.bezierCurveTo(-r*1.8,-r*.25,-r*.52,-r*1.2,0,-r*.42);
   ctx.bezierCurveTo(r*.52,-r*1.2,r*1.8,-r*.25,0,r*.65);ctx.fill();ctx.restore();return;
  }
  if(["stardust","frost"].includes(p.kind)){spark(p.x,p.y,r);return;}
  if(p.kind==="storm"){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-r*.45,p.y+r*3);ctx.stroke();return;}
  if(arc(p.x,p.y,r))ctx.fill();
 }
 function atmosphere(){
  const k=opts.cover_effect;
  if(!["aurora","eclipse","halo","neon","void","inferno"].includes(k))return;
  const glow=ctx.createRadialGradient(width*.51,height*.44,2,width*.51,height*.44,Math.max(4,width*.7));
  const shade=k==="inferno"?"255,91,41":k==="eclipse"?"146,110,238":k==="void"?"96,73,182":k==="halo"?"224,181,98":"51,223,213";
  glow.addColorStop(0,"rgba("+shade+","+(opts.intensity/950)+")");
  glow.addColorStop(1,"rgba("+shade+",0)");
  ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
  if(k==="aurora"||k==="neon"){
   const alpha=Math.min(.22,opts.intensity/430);
   ctx.strokeStyle="rgba(121,251,221,"+alpha+")";
   for(let j=0;j<(k==="aurora"?3:1);j++){
    ctx.beginPath();for(let x=0;x<=width;x+=14){
     const y=height*(.2+j*.18)+Math.sin(clock*.52+x*.015+j)*20;
     if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }ctx.lineWidth=k==="aurora"?10:3;ctx.stroke();
   }
  }
  if(k==="halo"||k==="eclipse"){
   ctx.strokeStyle="rgba(235,229,255,"+Math.min(.55,opts.intensity/230)+")";
   ctx.lineWidth=2;
   if(arc(width*.5,height*.44,Math.min(width*.24,height*.36)+Math.sin(clock*.7)*2))ctx.stroke();
  }
 }
 function frame(ts){
  raf=0;
  if(!shouldRun())return;
  if(last&&ts-last<1000/fps){raf=requestAnimationFrame(frame);return;}
  const dt=last?Math.min(.05,Math.max(0,(ts-last)/1000)):.033;
  last=ts;clock+=dt;
  ctx.clearRect(0,0,width,height);
  const count=Math.min(5,1+Math.ceil(opts.intensity/37));
  if(particles.length<cap){for(let i=0;i<count;i++)if(rand()<.70)add();}
  if(burst>0){burst=Math.max(0,burst-dt);}
  ctx.save();ctx.globalCompositeOperation="screen";
  atmosphere();
  const ink=color();
  particles=particles.filter(p=>{
   p.life-=dt;
   // Critical: never pass negative, infinite or NaN radii to Canvas arc().
   if(p.life<=0)return false;
   const proportion=Math.min(1,Math.max(0,p.life/p.max));
   const radius=safeFxRadius(p.size*proportion);
   if(radius<=0)return false;
   p.x+=(p.vx+Math.sin(clock*1.5+p.phase)*.20)*dt*60;
   const driftDown=(p.kind==="storm"||p.kind==="frost") ? .5 : p.vy;
   const driftY=["inferno","hearts","fireflies"].includes(p.kind) ? -.6 : driftDown;
   p.y+=driftY*dt*60;
   if(p.x<-30||p.x>width+30||p.y<-30||p.y>height+30)return false;
   ctx.fillStyle=ink;ctx.strokeStyle=ink;ctx.lineWidth=1;
   ctx.globalAlpha=Math.min(.75,proportion*.72)*opts.intensity/100;
   shape(p,radius);return true;
  });
  ctx.restore();
  raf=requestAnimationFrame(frame);
 }
 function apply(input){
  opts=normalizeFx(input);
  particles=[];clock=0;
  host.dataset.fxCover=opts.enabled?opts.cover_effect:"none";
  if(avatar){
    const effect=opts.enabled?opts.avatar_effect:"none";
    avatar.dataset.fxAvatar=effect;
    avatar.style.setProperty("--fx-avatar-color",COLORS[effect]||"#6ee7d4");
    avatar.style.setProperty("--fx-avatar-opacity",String(opts.intensity/100));
  }
  refresh();
 }
 function onResize(){resize();}
 function onVisibility(){refresh();}
 if("IntersectionObserver" in window){
  intersectionObserver=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);refresh();},{threshold:.07});
  intersectionObserver.observe(host);
 }else visible=true;
 if("ResizeObserver" in window){resizeObserver=new ResizeObserver(onResize);resizeObserver.observe(host);}
 else window.addEventListener("resize",onResize,{passive:true});
 document.addEventListener("visibilitychange",onVisibility);
 motion?.addEventListener?.("change",onVisibility);
 resize();
 function destroy(){
  if(disposed)return;disposed=true;stop();particles=[];
  intersectionObserver?.disconnect();resizeObserver?.disconnect();
  window.removeEventListener("resize",onResize);
  document.removeEventListener("visibilitychange",onVisibility);
  motion?.removeEventListener?.("change",onVisibility);
  if(avatar){delete avatar.dataset.fxAvatar;avatar.style.removeProperty("--fx-avatar-color");avatar.style.removeProperty("--fx-avatar-opacity");}
  ctx.clearRect(0,0,width,height);
 }
 return {apply,destroy,get state(){return {...opts}},get particleCount(){return particles.length}};
}
