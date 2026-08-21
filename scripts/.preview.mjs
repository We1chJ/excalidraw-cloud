// Temporary: nearest-neighbour magnifier so small icons can be eyeballed.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

function crc32(buf){let c=~0;for(const b of buf){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(0xedb88320&-(c&1));}return ~c>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t,'latin1'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b));return Buffer.concat([l,b,c]);}
function writePng(w,h,px){const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
  const raw=Buffer.alloc((w*4+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;px.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);}

function readPng(file){
  const buf=readFileSync(file); let off=8; let w=0,h=0; const idat=[];
  while(off<buf.length){
    const len=buf.readUInt32BE(off); const type=buf.toString('latin1',off+4,off+8); const data=buf.subarray(off+8,off+8+len);
    if(type==='IHDR'){w=data.readUInt32BE(0);h=data.readUInt32BE(4);}
    if(type==='IDAT')idat.push(data);
    off+=12+len;
  }
  const raw=inflateSync(Buffer.concat(idat));
  const px=Buffer.alloc(w*h*4); const stride=w*4;
  let prev=Buffer.alloc(stride);
  for(let y=0;y<h;y++){
    const f=raw[y*(stride+1)];
    const line=Buffer.from(raw.subarray(y*(stride+1)+1,y*(stride+1)+1+stride));
    for(let i=0;i<stride;i++){
      const a=i>=4?line[i-4]:0, b=prev[i], c=i>=4?prev[i-4]:0;
      if(f===1)line[i]=(line[i]+a)&255;
      else if(f===2)line[i]=(line[i]+b)&255;
      else if(f===3)line[i]=(line[i]+((a+b)>>1))&255;
      else if(f===4){const p=a+b-c;const pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);line[i]=(line[i]+(pa<=pb&&pa<=pc?a:pb<=pc?b:c))&255;}
    }
    line.copy(px,y*stride); prev=line;
  }
  return {w,h,px};
}

const [,,src,dst,scaleArg]=process.argv;
const scale=Number(scaleArg||16);
const {w,h,px}=readPng(src);
const W=w*scale,H=h*scale;
const out=Buffer.alloc(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const s=((y/scale|0)*w+(x/scale|0))*4, d=(y*W+x)*4;
  // composite over white so alpha is visible as it would be on a light toolbar
  const a=px[s+3]/255;
  for(let c=0;c<3;c++) out[d+c]=Math.round(px[s+c]*a+255*(1-a));
  out[d+3]=255;
}
writeFileSync(dst,writePng(W,H,out));
console.log(`${src} -> ${dst} (${W}x${H})`);
