import {readFile,writeFile} from 'node:fs/promises';
import {inflateSync,deflateSync} from 'node:zlib';
import {resolve} from 'node:path';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const channels={0:1,2:3,3:1,4:2,6:4};
function decodePng(buffer){
 if(!buffer.subarray(0,8).equals(signature))throw Error('Approved emblem is not a PNG');
 let width=0,height=0,depth=0,type=0,interlace=0,palette=null,transparency=null;
 const chunks=[];
 for(let pos=8;pos+12<=buffer.length;){
  const len=buffer.readUInt32BE(pos),name=buffer.toString('ascii',pos+4,pos+8);
  if(len>buffer.length-pos-12)throw Error('Damaged PNG chunk');
  const bytes=buffer.subarray(pos+8,pos+8+len);pos+=len+12;
  if(name==='IHDR'){
   width=bytes.readUInt32BE(0);height=bytes.readUInt32BE(4);depth=bytes[8];type=bytes[9];interlace=bytes[12];
  }else if(name==='IDAT')chunks.push(bytes);
  else if(name==='PLTE')palette=bytes;
  else if(name==='tRNS')transparency=bytes;
  if(name==='IEND')break;
 }
 if(!width||!height||width>4096||height>4096||!channels[type]||![1,2,4,8,16].includes(depth)||interlace!==0)
  throw Error('Unsupported source PNG format for approved PWA icon');
 if(type!==0&&type!==3&&depth<8)throw Error('Unsupported PNG sample depth');
 const n=channels[type],rowLength=Math.ceil(width*depth*n/8),bpp=Math.max(1,Math.ceil(n*depth/8));
 const unzipped=inflateSync(Buffer.concat(chunks));
 if(unzipped.length!==(rowLength+1)*height)throw Error('PNG scanline size mismatch');
 const pix=Buffer.alloc(width*height*4),prev=Buffer.alloc(rowLength),row=Buffer.alloc(rowLength);
 const sample=(x,bits)=>bits===16?row.readUInt16BE(x):bits===8?row[x]:0;
 const scale=(v,bits)=>bits===16?(v>>>8):bits===8?v:Math.round(v*255/((1<<bits)-1));
 function indexed(x){let bit=x*depth;return(row[bit>>3]>>(8-depth-(bit%8)))&((1<<depth)-1);}
 let offset=0;
 for(let y=0;y<height;y++){
  const filter=unzipped[offset++];if(filter>4)throw Error('Invalid PNG filter');
  for(let x=0;x<rowLength;x++){
   const raw=unzipped[offset++],a=x>=bpp?row[x-bpp]:0,b=prev[x],c=x>=bpp?prev[x-bpp]:0;
   let pred=0;
   if(filter===1)pred=a;
   if(filter===2)pred=b;
   if(filter===3)pred=(a+b)>>1;
   if(filter===4){const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);pred=da<=db&&da<=dc?a:db<=dc?b:c;}
   row[x]=(raw+pred)&255;
  }
  for(let x=0;x<width;x++){
   const k=(y*width+x)*4;let r=0,g=0,b=0,a=255;
   if(type===6){let j=x*4*(depth/8);r=scale(sample(j,depth),depth);g=scale(sample(j+depth/8,depth),depth);b=scale(sample(j+2*depth/8,depth),depth);a=scale(sample(j+3*depth/8,depth),depth);}
   if(type===2){let j=x*3*(depth/8);r=scale(sample(j,depth),depth);g=scale(sample(j+depth/8,depth),depth);b=scale(sample(j+2*depth/8,depth),depth);}
   if(type===4){let j=x*2*(depth/8);r=g=b=scale(sample(j,depth),depth);a=scale(sample(j+depth/8,depth),depth);}
   if(type===0){let v=depth>=8?sample(x*(depth/8),depth):indexed(x);r=g=b=scale(v,depth);}
   if(type===3){let ix=indexed(x);if(!palette||ix*3+2>=palette.length)throw Error('Invalid PNG palette');r=palette[ix*3];g=palette[ix*3+1];b=palette[ix*3+2];a=transparency?.[ix]??255;}
   pix[k]=r;pix[k+1]=g;pix[k+2]=b;pix[k+3]=a;
  }
  row.copy(prev);
 }
 return {width,height,pixels:pix};
}
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const tag=Buffer.from(type);let crc=0xffffffff;for(const c of Buffer.concat([tag,data]))crc=crcTable[(crc^c)&255]^(crc>>>8);const end=Buffer.alloc(4);end.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([len,tag,data,end]);}
function encodePng(width,height,rgba){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;const bytes=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)rgba.copy(bytes,y*(width*4+1)+1,y*width*4,(y+1)*width*4);return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(bytes,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
function render(src,size,padding){
 const out=Buffer.alloc(size*size*4);const bg=[13,35,49];
 const scale=Math.min((size*(1-padding*2))/src.width,(size*(1-padding*2))/src.height);
 const w=src.width*scale,h=src.height*scale,left=(size-w)/2,top=(size-h)/2;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const outIdx=(y*size+x)*4;out[outIdx]=bg[0];out[outIdx+1]=bg[1];out[outIdx+2]=bg[2];out[outIdx+3]=255;
  const sx=(x-left)/scale,sy=(y-top)/scale;
  if(sx<0||sy<0||sx>=src.width||sy>=src.height)continue;
  const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,src.width-1),y1=Math.min(y0+1,src.height-1),ax=sx-x0,ay=sy-y0;
  const weights=[(1-ax)*(1-ay),ax*(1-ay),(1-ax)*ay,ax*ay];const pixels=[(y0*src.width+x0)*4,(y0*src.width+x1)*4,(y1*src.width+x0)*4,(y1*src.width+x1)*4];
  let alpha=0,r=0,g=0,b=0;
  for(let i=0;i<4;i++){const k=pixels[i],a=src.pixels[k+3]/255*weights[i];alpha+=a;r+=a*src.pixels[k];g+=a*src.pixels[k+1];b+=a*src.pixels[k+2];}
  out[outIdx]=Math.round(r+bg[0]*(1-alpha));out[outIdx+1]=Math.round(g+bg[1]*(1-alpha));out[outIdx+2]=Math.round(b+bg[2]*(1-alpha));
 }
 return encodePng(size,size,out);
}
export async function createPwaIcons(output){
 const original=await readFile(resolve(output,'assets/brand/blipmood-emblem-light.png'));
 const image=decodePng(original);
 for(const [size,padding,suffix] of [[192,.1,'192'],[512,.1,'512'],[512,.22,'maskable-512']]){
  await writeFile(resolve(output,`assets/brand/blipmood-pwa-${suffix}.png`),render(image,size,padding));
 }
}


// Responsive hero artwork keeps the exact approved transparent emblem,
// preserving colors and alpha without introducing a new design or dependency.
function resizeTransparent(source,targetWidth){
 const width=targetWidth;
 const height=Math.max(1,Math.round(targetWidth*source.height/source.width));
 const result=Buffer.alloc(width*height*4);
 const factorX=source.width/width,factorY=source.height/height;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sx=Math.max(0,Math.min(source.width-1,(x+.5)*factorX-.5));
  const sy=Math.max(0,Math.min(source.height-1,(y+.5)*factorY-.5));
  const x0=Math.floor(sx),y0=Math.floor(sy);
  const x1=Math.min(x0+1,source.width-1),y1=Math.min(y0+1,source.height-1);
  const fx=sx-x0,fy=sy-y0;
  const p=[(y0*source.width+x0)*4,(y0*source.width+x1)*4,
           (y1*source.width+x0)*4,(y1*source.width+x1)*4];
  const weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
  let alpha=0,r=0,g=0,b=0;
  for(let i=0;i<4;i++){
   const a=source.pixels[p[i]+3]/255*weights[i];
   alpha+=a;r+=source.pixels[p[i]]*a;
   g+=source.pixels[p[i]+1]*a;b+=source.pixels[p[i]+2]*a;
  }
  const out=(y*width+x)*4;
  result[out]=alpha?Math.round(r/alpha):0;
  result[out+1]=alpha?Math.round(g/alpha):0;
  result[out+2]=alpha?Math.round(b/alpha):0;
  result[out+3]=Math.round(alpha*255);
 }
 return encodePng(width,height,result);
}
export async function createResponsiveEmblemAssets(output){
 const brandFolder=resolve(output,"assets/brand");
 for(const theme of ["light","dark"]){
  const src=decodePng(await readFile(resolve(brandFolder,"blipmood-emblem-"+theme+".png")));
  for(const width of [180,420]){
   const file=resolve(brandFolder,"blipmood-emblem-"+theme+"-"+width+".png");
   await writeFile(file,resizeTransparent(src,width));
  }
 }
}
