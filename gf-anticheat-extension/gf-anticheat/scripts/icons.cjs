/* Original geometric shield/document/check artwork; vector and supersampled PNG share polygons. */
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'assets'); fs.mkdirSync(out, { recursive: true });
const shapes = [
  { color: '#285bb5', points: [[16,2],[29,7],[28,19],[23,26],[16,30],[9,26],[4,19],[3,7]] },
  { color: '#ffffff', points: [[10,8],[18,8],[22,12],[22,24],[10,24]] },
  { color: '#c9daf5', points: [[18,8],[18,12],[22,12]] },
  { color: '#285bb5', points: [[11.5,16],[13.5,14],[15.5,16],[20,11.5],[22,13.5],[15.5,20]] }
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="FormSentry shield, document and checkmark">${shapes.map(s => `<polygon fill="${s.color}" points="${s.points.map(p=>p.join(',')).join(' ')}"/>`).join('')}</svg>\n`;
fs.writeFileSync(path.join(out, 'logo.svg'), svg); fs.writeFileSync(path.join(out, 'favicon.svg'), svg);
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let b=0;b<8;b++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const t = Buffer.from(type), n = Buffer.alloc(4), crc = Buffer.alloc(4); n.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t,data]))); return Buffer.concat([n,t,data,crc]); }
function inside(x,y,points) { let hit=false; for(let i=0,j=points.length-1;i<points.length;j=i++) { const [a,b]=points[i],[c,d]=points[j]; if ((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a) hit=!hit; } return hit; }
for (const size of [16,32,48,128]) {
  const pixels=Buffer.alloc((size*4+1)*size), samples=4;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const sums=[0,0,0,0];
    for(let sy=0;sy<samples;sy++) for(let sx=0;sx<samples;sx++) {
      let color;
      for(const shape of shapes) if(inside((x+(sx+.5)/samples)*32/size,(y+(sy+.5)/samples)*32/size,shape.points)) color=shape.color;
      if(color) { sums[0]+=parseInt(color.slice(1,3),16); sums[1]+=parseInt(color.slice(3,5),16); sums[2]+=parseInt(color.slice(5,7),16); sums[3]++; }
    }
    const offset=y*(size*4+1)+1+x*4;
    for(let c=0;c<3;c++) pixels[offset+c]=sums[3]?Math.round(sums[c]/sums[3]):0;
    pixels[offset+3]=Math.round(sums[3]/(samples*samples)*255);
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
  fs.writeFileSync(path.join(out,`icon-${size}.png`),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
}
console.log('Generated original SVG artwork and 16/32/48/128px PNG icons.');
