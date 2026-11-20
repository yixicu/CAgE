import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { createCanvas, loadImage } = createRequire(new URL('../../app/package.json', import.meta.url))('@napi-rs/canvas');

// Match the default blue palette and source-channel normalization in web/branding/engine-mark.ts.
function tintEnginePixels(bytes) {
  const low=[25,55,98], high=[141,195,245];
  for(let i=0;i<bytes.length;i+=4){const tone=Math.max(0,Math.min(1,(bytes[i+2]-80)/160));for(let c=0;c<3;c++) bytes[i+c]=low[c]+tone*(high[c]-low[c]);}
}

const source = await loadImage(fileURLToPath(new URL('../../app/web/public/branding/engine-a-v4.png',import.meta.url)));
const sizes = [16,24,32,48,64,128,256];
const header = Buffer.alloc(6+16*sizes.length);
header.writeUInt16LE(1,2);
header.writeUInt16LE(sizes.length,4);
let offset = header.length;
const frames = sizes.map((size,index)=>{
  const canvas = createCanvas(size,size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source,0,0,size,size);
  const pixels = ctx.getImageData(0,0,size,size);
  tintEnginePixels(pixels.data,'blue');
  const stride = Math.ceil(size/32)*4;
  const bitmap = Buffer.alloc(40+4*size*size+stride*size);
  bitmap.writeUInt32LE(40);
  bitmap.writeInt32LE(size,4);
  bitmap.writeInt32LE(size*2,8);
  bitmap.writeUInt16LE(1,12);
  bitmap.writeUInt16LE(32,14);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const i=4*(y*size+x), j=40+4*((size-1-y)*size+x);
    bitmap[j]=pixels.data[i+2]; bitmap[j+1]=pixels.data[i+1];
    bitmap[j+2]=pixels.data[i]; bitmap[j+3]=pixels.data[i+3];
    if(!pixels.data[i+3]) bitmap[40+4*size*size+(size-1-y)*stride+(x>>3)] |= 128>>(x%8);
  }
  const entry=6+index*16;
  header[entry]=header[entry+1]=size%256;
  header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);
  header.writeUInt32LE(bitmap.length,entry+8);header.writeUInt32LE(offset,entry+12);
  offset+=bitmap.length;
  return bitmap;
});
writeFileSync(new URL('../shell/icons/icon.ico',import.meta.url),Buffer.concat([header,...frames]));
