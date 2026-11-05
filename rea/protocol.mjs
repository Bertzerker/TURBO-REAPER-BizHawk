// SPDX-License-Identifier: MIT
export function unpack(packet) {
 if(packet.length<4)throw Error('Short packet');
 const n=packet.readUInt32LE(0);
 if(n>1_000_000 || n+4>packet.length)throw Error('Invalid metadata length');
 const meta=JSON.parse(packet.subarray(4,4+n).toString('utf8'));
 const payload=packet.subarray(4+n);
 if(meta.type!=='frame')return {meta,payload};
 if(meta.schema!==1 || !/^[a-f0-9]{32}-\d+$/.test(meta.id))throw Error('Unsupported snapshot');
 if(!Array.isArray(meta.domains)||meta.domains.length>32||!meta.atlas||!Array.isArray(meta.atlas.panels)||meta.atlas.panels.length>16)throw Error('Invalid descriptors');
 for(const p of meta.atlas.panels)if(![p.x,p.y,p.width,p.height].every(Number.isSafeInteger)||p.x<0||p.y<0||p.width<1||p.height<1||p.x+p.width>meta.atlas.width||p.y+p.height>meta.atlas.height)throw Error('Invalid panel bounds');
 let end=0;
 for(const block of [...meta.domains,meta.atlas,meta.tiles,...(meta.raster?[meta.raster]:[]),...(meta.tileRows?[meta.tileRows]:[])]) {
  const size=block.length??block.size;
  if(!Number.isSafeInteger(block.offset)||!Number.isSafeInteger(size)||size<0||block.offset!==end)throw Error('Invalid block layout');
  end+=size;
 }
 if(end!==payload.length || meta.atlas.length!==meta.atlas.width*meta.atlas.height*4)throw Error('Invalid capture length');
 if(meta.raster?.valid){
  const {width,height,length}=meta.raster;
  if(!Number.isInteger(width)||width<1||width>1024||!Number.isInteger(height)||height<1||height>512||length!==width*height*4)throw Error('Invalid native raster geometry');
  if(meta.tileRows&&(meta.tileRows.rowWords!==70||meta.tileRows.length!==height*140))throw Error('Invalid native BAT rows');
 }
 return {meta,payload,packet};
}
export function spriteSample(s,x,y){
 const r=s.meta.raster;
 if(!r?.valid||x<0||y<0||x>=r.width||y>=r.height)return null;
 const word=s.payload.readUInt32LE(r.offset+(y*r.width+x)*4);
 if(r.spriteEncoding==='pce-obj-v2')return word&64?{slot:word&63,paletteIndex:(word>>>7)&511,pattern:(word>>>16)&511,flags:word>>>25}:null;
 return (word&65535)===65535?null:{slot:word&65535,paletteIndex:word>>>16};
}

export function tileRow(s,y){
 const rows=s.meta.tileRows,r=s.meta.raster;
 if(!rows||!r?.valid||y<0||y>=r.height)return null;
 const row=rows.offset+y*140;
 const width=s.payload.readUInt16LE(row),scroll=s.payload.readUInt16LE(row+2);
 const vertical=s.payload.readUInt16LE(row+4),columns=s.payload.readUInt16LE(row+6);
 if(width<1||width>Math.min(r.width,512)||scroll>1023||vertical>511||![32,64,128].includes(columns))return null;
 return {offset:row+8,width,scroll,vertical,columns,y};
}
export function tileSpan(s,row,x){
 const {offset,scroll,vertical,columns,y}=row;
 const span=((scroll&7)+x)>>>3,word=s.payload.readUInt16LE(offset+span*2);
 const batWord=(vertical>>>3)*columns+(((scroll>>>3)+span)&(columns-1));
 return {pattern:word&2047,palette:word>>>12,batWord,x:span*8-(scroll&7),y:y-(vertical&7),scrollX:scroll,scrollY:vertical};
}
export function tileSample(s,x,y){
 const row=tileRow(s,y);
 return row&&x>=0&&x<row.width?tileSpan(s,row,x):null;
}
export class Framer {
 constructor(onPacket){this.onPacket=onPacket;this.parts=[];this.length=0;this.expected=null;this.prefix=Buffer.alloc(4);this.prefixCount=0;}
 push(chunk){
  let p=0;
  while(p<chunk.length){
   if(this.expected===null){
    const n=Math.min(4-this.prefixCount,chunk.length-p);chunk.copy(this.prefix,this.prefixCount,p,p+n);p+=n;this.prefixCount+=n;
    if(this.prefixCount<4)continue;
    this.expected=this.prefix.readUInt32LE(0);this.prefixCount=0;
    if(this.expected<4||this.expected>32*1024*1024)throw Error('Invalid packet length');
   }
   const n=Math.min(this.expected-this.length,chunk.length-p);
   this.parts.push(chunk.subarray(p,p+n));this.length+=n;p+=n;
   if(this.length===this.expected){const packet=Buffer.concat(this.parts,this.length);this.parts=[];this.length=0;this.expected=null;this.onPacket(unpack(packet));}
  }
 }
}
export function range(meta,payload,space,start,length){
 const domain=meta.domains.find(d=>d.name.toLowerCase()===space.toLowerCase());
 if(!domain)throw Error('Unknown memory domain');
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<1||length>4096||start>=domain.size)throw Error('Memory range is out of bounds (length 1..4096)');
 return {domain,bytes:payload.subarray(domain.offset+start,domain.offset+Math.min(start+length,domain.size))};
}
export function inspectPixel(s,view,x,y){
 const p=s.meta.atlas.panels.find(p=>p.view===view);
 if(!p||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=p.width||y>=p.height)throw Error('Pixel outside view');
 if(!p.supported)throw Error('View unavailable in this capture');
 const at=s.meta.atlas.offset+((p.y+y)*s.meta.atlas.width+p.x+x)*4,b=s.payload.subarray(at,at+4),r=s.meta.raster;
 let nativeSamples=null;
 if(r?.valid&&r.length&&['composite','bg1','obj','source'].includes(view)){
  const sprite=spriteSample(s,x,y);
  const sp=s.meta.atlas.panels.find(p=>p.view==='source'),sourceWord=sp?s.payload.readUInt32LE(s.meta.atlas.offset+((sp.y+y)*s.meta.atlas.width+sp.x+x)*4)>>>0:0;
  nativeSamples={compositeSource:({[0xff92d6b2]:'background',[0xffe4be7c]:'sprite',[0xff334251]:'backdrop'})[sourceWord]??'unrecorded border',generation:r.generation,spriteIndex:sprite?.slot??null,spritePaletteIndex:sprite?.paletteIndex??null,spritePattern:sprite?.pattern??null,spriteFlags:sprite?.flags??null,backgroundTile:tileSample(s,x,y),sampling:'admitted sprite before background priority; raster-time palette RGB',exactFetchAddress:null};
 }
 return {snapshot:s.meta.id,frame:s.meta.frame,view,x,y,native:{x,y,framebufferWidth:s.meta.geometry?.width,cropTop:s.meta.geometry?.topLine},supported:p.supported,kind:p.kind,rgb:[b[2],b[1],b[0]],alpha:b[3],nativeSamples,provenance:null,provenanceReason:'Exact VRAM fetch and CPU/DMA provenance unavailable; PCEHawk scanline/cache renderer',spriteBounds:['obj','composite'].includes(view)?s.meta.sprites.filter(o=>x>=o.x&&x<o.x+o.width&&y>=o.y&&y<o.y+o.height):undefined};
}
export function logicalAddress(s,address){
 if(!Number.isInteger(address)||address<0||address>65535)throw Error('Logical CPU address must be 0..65535');
 const mpr=s.meta.ppu?.mpr;if(!mpr||mpr.length!==8)throw Error('Captured MPR context unavailable');
 const bank=mpr[address>>>13],physical=bank*8192+(address&8191);
 const base={snapshot:s.meta.id,logicalAddress:address,mprSlot:address>>>13,bank,physicalAddress:physical};
 if(bank>=0xf8&&bank<=0xfb){const offset=address&8191,{domain,bytes}=range(s.meta,s.payload,'Main Memory',offset,1);return {...base,available:true,domain:domain.name,offset,byte:bytes[0],semantics:'8 KiB backing RAM mirror; no bus reads'};}
 return {...base,available:false,reason:bank===255?'I/O reads are forbidden; no safe copied domain':'ROM/mapper or peripheral region is not retained as a copied bus domain'};
}
