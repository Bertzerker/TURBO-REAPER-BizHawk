// SPDX-License-Identifier: MIT
import {randomUUID,createHash} from 'node:crypto';
import {lstat,mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {inspectPixel,spriteSample,tileSample,tileRow,tileSpan} from './protocol.mjs';

const schema=1, maxEntries=256, maxSelectors=32, maxBytes=512*1024;
const types={sprite:['vdc-sprite'],tile:['vdc-tile','bat-tile']};
const error=(message,status=400)=>Object.assign(Error(message),{status});
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

export function catalogGame(meta){
 const digest=meta.rom?.mappedSha256?.toLowerCase();
 if(!/^[a-f0-9]{64}$/.test(digest??'')||meta.core!=='BizHawk.Emulation.Cores.PCEngine.PCEngine'||meta.mode!=='standard HuCard'){
  throw error('Render a PCEHawk HuCard frame with mapped ROM SHA-256 identity to use the catalog');
 }
 return {system:'pce-hucard',digest:{algorithm:'sha256',value:digest},core:meta.core,selectorVersion:1};
}

function sameGame(a,b){
 return a?.system===b.system&&a.digest?.algorithm===b.digest.algorithm&&a.digest?.value===b.digest.value&&a.core===b.core&&a.selectorVersion===b.selectorVersion;
}

function field(value,limit,name){
 if(typeof value!=='string'||value.length>limit)throw error('Invalid '+name);
 return value.trim();
}

function selectors(kind,items){
 if(!Object.hasOwn(types,kind)||!Array.isArray(items)||!integer(items.length,1,maxSelectors))throw error('Use 1–32 selectors for a sprite or tile entry');
 const unique=new Map();
 for(const item of items){
  if(!object(item)||!types[kind].includes(item.type)||!integer(item.pattern,0,kind==='sprite'?511:2047))throw error('Invalid VDC selector type or pattern');
  const allowed=kind==='sprite'?['type','pattern','palette','flags']:['type','pattern','palette','batWord'];
  if(Object.keys(item).some(key=>!allowed.includes(key)))throw error('Unknown selector field');
  const selector={type:item.type,pattern:item.pattern};
  for(const [name,max] of [['palette',15],['flags',127],['batWord',8191]]){
   if(item[name]===undefined)continue;
   if(!integer(item[name],0,max))throw error('Invalid selector '+name);
   selector[name]=item[name];
  }
  unique.set(JSON.stringify(selector),selector);
 }
 const result=[...unique.values()];
 if(result.some(s=>s.type!==result[0].type))throw error('Keep raster and BAT diagnostic selectors in separate entries');
 return result;
}

function definition(kind,value){
 if(!object(value))throw error('Invalid entry');
 const name=field(value.name,80,'name');
 if(!name)throw error('An entry name is required');
 const labels=value.labels??[];
 if(!Array.isArray(labels)||labels.length>12)throw error('Use at most 12 labels');
 return {kind,name,labels:[...new Set(labels.map(label=>field(label,32,'label')).filter(Boolean))],notes:field(value.notes??'',2000,'notes'),selectors:selectors(kind,value.selectors)};
}

function parseDocument(value,game){
 if(!object(value)||value.schema!==schema||!sameGame(value.game,game)||!integer(value.revision,0,Number.MAX_SAFE_INTEGER-1)||!Array.isArray(value.entries)||value.entries.length>maxEntries)throw error('Catalog schema or HuCard identity does not match');
 const ids=new Set();
 const entries=value.entries.map(entry=>{
  if(!object(entry)||!uuid(entry.id)||ids.has(entry.id)||!integer(entry.revision,1,Number.MAX_SAFE_INTEGER-1))throw error('Invalid catalog entry identity');
  ids.add(entry.id);
  return {id:entry.id,revision:entry.revision,...definition(entry.kind,entry)};
 });
 return {schema,game,revision:value.revision,entries};
}

export class CatalogStore {
 constructor(root){this.root=path.join(root,'catalog');this.writes=Promise.resolve();}
 async read(game){
  const directory=await lstat(this.root).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(directory&&!directory.isDirectory())throw error('Catalog root must be a regular directory');
  const file=path.join(this.root,game.digest.value+'.json');
  const info=await lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(!info)return {schema,game,revision:0,entries:[]};
  if(!info.isFile()||info.size>maxBytes)throw error('Catalog must be a bounded regular JSON file');
  const bytes=await readFile(file);
  if(bytes.length>maxBytes)throw error('Catalog is too large');
  return parseDocument(JSON.parse(bytes.toString('utf8')),game);
 }
 async change(game,input,seed){
  const operation=this.writes.catch(()=>{}).then(async()=>{
   const current=await this.read(game);
   if(input.revision!==current.revision)throw error('Catalog changed. Reload before saving your edit.',409);
   const index=current.entries.findIndex(entry=>entry.id===input.id);
   const old=current.entries[index];
   let selected;
   switch(input.action){
    case 'create':
     if(!seed)throw error('Pick evidence before adding an entry');
     selected={id:randomUUID(),revision:1,...definition(seed.kind,{...input,selectors:[seed.selector]})};
     current.entries.push(selected);
     break;
    case 'append':
     if(!old||!seed||old.kind!==seed.kind)throw error('Pick evidence of the same kind to append');
     selected={...old,revision:old.revision+1,selectors:selectors(old.kind,[...old.selectors,seed.selector])};
     current.entries[index]=selected;
     break;
    case 'edit':
     if(!old)throw error('Entry was removed. Reload the catalog.',409);
     selected={id:old.id,revision:old.revision+1,...definition(old.kind,input)};
     current.entries[index]=selected;
     break;
    case 'import': {
     const imported=parseDocument(input.catalog,game);
     const existing=new Set(current.entries.map(entry=>entry.id));
     if(imported.entries.some(entry=>existing.has(entry.id)))throw error('An imported entry ID already exists in this catalog',409);
     current.entries.push(...imported.entries);
     break;
    }
    case 'delete':
     if(!old)throw error('Entry was removed. Reload the catalog.',409);
     current.entries.splice(index,1);
     break;
    default:throw error('Unknown catalog action');
   }
   if(current.entries.length>maxEntries)throw error('Catalog limit is 256 entries per HuCard');
   current.revision++;
   const bytes=JSON.stringify(current,null,2);
   if(Buffer.byteLength(bytes)>maxBytes)throw error('Catalog exceeds 512 KiB');
   await mkdir(this.root,{recursive:true});
   const temp=path.join(this.root,randomUUID()+'.tmp');
   try{
    await writeFile(temp,bytes,{flag:'wx'});
    await rename(temp,path.join(this.root,game.digest.value+'.json'));
   }finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
   return {catalog:current,selected:selected?.id};
  });
  this.writes=operation;
  return operation;
 }
}

function batWord(s,address){
 const domain=s.meta.domains.find(d=>d.name==='VRAM1');
 if(!domain||address*2+2>domain.size||!['Big','Little'].includes(domain.endian))return null;
 return domain.endian==='Big'?s.payload.readUInt16BE(domain.offset+address*2):s.payload.readUInt16LE(domain.offset+address*2);
}

function diagnosticTile(s,x,y){
 const columns=s.meta.bgs?.[0]?.batWidth;
 if(![32,64,128].includes(columns))return null;
 const address=(y>>>3)*columns+(x>>>3),word=batWord(s,address);
 return word===null?null:{pattern:word&2047,palette:word>>>12,batWord:address,x:x&~7,y:y&~7};
}

export function pickCatalog(s,view,x,y){
 catalogGame(s.meta);
 if(!['obj','bg1','composite','bat'].includes(view))throw error('Pick from Composite, Sprites, Background or BAT diagnostic');
 const pixel=inspectPixel(s,view,x,y),source=pixel.nativeSamples?.compositeSource;
 const base={snapshot:s.meta.id,frame:s.meta.frame,view,x,y};
 if(view==='obj'||view==='composite'&&source==='sprite'){
  const sprite=spriteSample(s,x,y);
  if(sprite?.pattern===undefined)throw error('No admitted sprite pattern at this pixel. Render a frame with catalog capture enabled.');
  const palette=(sprite.paletteIndex-256)>>>4;
  return {...base,kind:'sprite',evidenceClass:'admitted-sprite-raster',locator:{...sprite,palette,patternWord:sprite.pattern*64},selector:{type:'vdc-sprite',pattern:sprite.pattern,palette,flags:sprite.flags}};
 }
 if(view==='bg1'||view==='composite'&&source==='background'||view==='bat'){
  if(view!=='bat'&&s.meta.raster?.width>512)throw error('Render-time BAT attribution supports capture widths up to 512 pixels.');
  const tile=view==='bat'?diagnosticTile(s,x,y):pixel.alpha?tileSample(s,x,y):null;
  if(!tile)throw error('No attributed background sample. Pick a visible Background pixel or use the BAT diagnostic.');
  return {...base,kind:'tile',evidenceClass:view==='bat'?'boundary-bat-diagnostic':'render-time-bat',locator:{...tile,patternWord:tile.pattern*16},selector:{type:view==='bat'?'bat-tile':'vdc-tile',pattern:tile.pattern,palette:tile.palette}};
 }
 throw error('No catalog sample at this Composite pixel. Inspect the Background or Sprites layer.');
}

const classes={'vdc-sprite':'admitted-sprite-raster','vdc-tile':'render-time-bat','bat-tile':'boundary-bat-diagnostic'};
const views={'vdc-sprite':'obj','vdc-tile':'bg1','bat-tile':'bat'};
function matches(selector,sample){
 return selector.pattern===sample.pattern&&
  (selector.palette===undefined||selector.palette===sample.palette)&&
  (selector.flags===undefined||selector.flags===sample.flags)&&
  (selector.batWord===undefined||selector.batWord===sample.batWord);
}

export function scanMatches(s,entry,{keepPixels=false,batLocator}={}){
 const type=entry.selectors[0].type,view=views[type],evidenceClass=classes[type];
 const panel=s.meta.atlas.panels.find(p=>p.view===view);
 const {width=0,height=0}=panel??{};
 const base={width,height,view,evidenceClass,candidates:[],pixels:null};
 if(type==='vdc-tile'&&width>512)return {...base,reason:'Render-time BAT attribution supports capture widths up to 512 pixels.'};
 if(!panel?.supported||(type==='vdc-sprite'&&s.meta.raster?.spriteEncoding!=='pce-obj-v2')||(type==='vdc-tile'&&!s.meta.tileRows)){
  return {...base,reason:'This frame lacks catalog attribution. Render a complete frame with catalog capture enabled.'};
 }
 const {atlas}=s.meta,groups=new Map(),patterns=new Map();
 for(const selector of entry.selectors){
  const group=patterns.get(selector.pattern)??[];
  group.push(selector);
  patterns.set(selector.pattern,group);
 }
 const pixels=keepPixels?new Uint16Array(width*height):null;
 const isSprite=type==='vdc-sprite',isNativeTile=type==='vdc-tile';
 for(let y=0;y<height;y++){
  const row=isNativeTile?tileRow(s,y):null;
  if(isNativeTile&&(!row||batLocator!==undefined&&Math.floor(batLocator/row.columns)!==(row.vertical>>>3)))continue;
  const limit=row?.width??width,alpha=atlas.offset+((panel.y+y)*atlas.width+panel.x)*4+3;
  for(let start=0;start<limit;){
   const end=isSprite?start+1:Math.min(limit,start+8-((start+(row?.scroll??0))&7));
   const sample=isSprite?(s.payload[alpha+start*4]?spriteSample(s,start,y):null):row?tileSpan(s,row,start):diagnosticTile(s,start,y);
   if(sample&&isSprite)sample.palette=(sample.paletteIndex-256)>>>4;
   if(sample&&(batLocator===undefined||sample.batWord===batLocator)&&patterns.get(sample.pattern)?.some(selector=>matches(selector,sample))){
    const key=isSprite?'slot-'+sample.slot:'tile-'+sample.batWord+':'+sample.x+':'+sample.y;
    let group=null;
    for(let x=start;x<end;x++){
     if(!s.payload[alpha+x*4])continue;
     if(!group){
      group=groups.get(key);
      if(!group){
       if(groups.size>=4096)return {...base,reason:'Match coverage exceeds 4096 instances. Narrow the selectors.'};
       group={id:key,index:groups.size+1,slot:sample.slot,batWord:sample.batWord,origin:isSprite?undefined:{x:sample.x,y:sample.y},flags:sample.flags,left:x,top:y,right:x,bottom:y,count:0,patterns:new Set(),palettes:new Set()};
       groups.set(key,group);
      }
      if(group.flags!==sample.flags)return {...base,reason:'A matched SATB slot changed flags within this capture. Re-pick in a stable frame.'};
      group.patterns.add(sample.pattern);
      group.palettes.add(sample.palette);
     }
     group.left=Math.min(group.left,x);
     group.top=Math.min(group.top,y);
     group.right=Math.max(group.right,x);
     group.bottom=Math.max(group.bottom,y);
     group.count++;
     if(pixels)pixels[y*width+x]=group.index;
    }
   }
   start=end;
  }
 }
 const candidates=[...groups.values()].map(({left,top,right,bottom,patterns,palettes,...group})=>({
  ...group,bounds:{x:left,y:top,width:right-left+1,height:bottom-top+1},patterns:[...patterns],palettes:[...palettes]
 }));
 return {...base,candidates,pixels,panel};
}

export function isolatedPixels(s,scan,selected){
 const {width,height,pixels,panel}=scan,output=Buffer.alloc(width*height*4);
 const {atlas}=s.meta;
 for(let i=0;i<pixels.length;i++){
  if(!pixels[i]||selected&&pixels[i]!==selected.index)continue;
  const src=atlas.offset+((panel.y+Math.floor(i/width))*atlas.width+panel.x+i%width)*4;
  s.payload.copy(output,i*4,src,src+4);
 }
 return output;
}
