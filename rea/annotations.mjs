// SPDX-License-Identifier: MIT
import {mkdir,readFile,readdir,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {unpack} from './protocol.mjs';
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const digest=b=>createHash('sha256').update(b).digest('hex');
function markdownExport(note){
 const content=note.format==='markdown'?note.body:'```'+note.format+'\n'+note.body+'\n```\n';
 return `---\nannotation: ${note.id}\nmovie: ${JSON.stringify(note.movie.filename)}\nmovie_frame: ${note.movie.timelineFrame}\nemulated_frame: ${note.snapshot.frame}\nsnapshot: ${note.snapshot.id}\nrom_sha1: ${note.snapshot.rom.hash}\n---\n\n# ${note.title}\n\n${content}`;
}
export function validateNote(input){
 const title=String(input.title??'').trim(),format=input.format??'markdown',body=String(input.body??'');
 if(title.length>200||body.length>100000)throw Error('Comment is too long');
 if(!['markdown','json','mermaid'].includes(format))throw Error('Unsupported comment format');
 if(format==='json'&&body.trim())JSON.parse(body);
 if(format==='markdown')for(const match of body.matchAll(/```json\s*\n([\s\S]*?)```/g))JSON.parse(match[1]);
 const category=input.category??'observation';if(!['observation','hypothesis','question'].includes(category))throw Error('Unsupported comment type');
 return {title:title||'Frame observation',format,body,category};
}
export class Annotations {
 constructor(root,makePng){this.root=path.join(root,'annotations');this.makePng=makePng;this.writes=new Map();}
 folder(id){if(!validId(id))throw Error('Invalid annotation ID');return path.join(this.root,id);}
 async get(id){return JSON.parse(await readFile(path.join(this.folder(id),'annotation.json'),'utf8'));}
 async list(){
  const names=await readdir(this.root).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const rows=await Promise.all(names.filter(validId).map(id=>this.get(id).catch(()=>null)));
  return rows.filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 async capture(s,movieCopy=null){
  const id=randomUUID(),folder=this.folder(id),staging=folder+'.pending';await mkdir(staging,{recursive:true});
  try {
   const m=s.meta,packet=s.packet,atlas=this.makePng(s),composite=this.makePng(s,'composite'),memory=s.payload.subarray(0,m.atlas.offset);
   const record={schema:1,id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),revision:1,revisions:[],title:'Frame '+m.frame,format:'markdown',body:'',snapshot:{id:m.id,frame:m.frame,generation:m.raster?.generation,rom:m.rom,core:m.core,version:m.version,timing:m.timing,native:!!m.raster?.valid},movie:{...m.movie,filename:m.movie?.filename?.split(/[\\/]/).at(-1)??'',timelineFrame:m.movie?.timelineFrame??null,previousInputRow:m.movie?.timelineFrame>0?m.movie.timelineFrame-1:null,sha256:movieCopy?digest(movieCopy):null,archived:!!movieCopy},domains:m.domains,files:{capture:{name:'capture.bin',sha256:digest(packet),bytes:packet.length},atlas:{name:'atlas.png',sha256:digest(atlas),bytes:atlas.length},composite:{name:'composite.png',sha256:digest(composite),bytes:composite.length},memory:{name:'memory.bin',sha256:digest(memory),bytes:memory.length}}};
   const files=[['capture.bin',packet],['atlas.png',atlas],['composite.png',composite],['memory.bin',memory],['snapshot.json',JSON.stringify(m,null,2)],['annotation.json',JSON.stringify(record,null,2)],['comment.md',markdownExport(record)]];
   if(movieCopy)files.push(['movie.bk2',movieCopy]);
   await Promise.all(files.map(([name,bytes])=>writeFile(path.join(staging,name),bytes,{flag:'wx'})));
   await rename(staging,folder);return record;
  }catch(e){await rm(staging,{recursive:true,force:true});throw e;}
 }
 async update(id,input){
  const previous=this.writes.get(id)??Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{
   const old=await this.get(id);if(input.revision!==old.revision)throw Object.assign(Error('This comment changed in another tab. Reopen it before saving.'),{status:409});
   const note=validateNote(input),record={...old,...note,revisions:[...(old.revisions??[]),{revision:old.revision,title:old.title,body:old.body,format:old.format,category:old.category,updatedAt:old.updatedAt}],revision:old.revision+1,updatedAt:new Date().toISOString()},folder=this.folder(id);
   // The JSON revision is authoritative; the Markdown file is an export copy.
   await writeFile(path.join(folder,'comment.md'),markdownExport(record));
   const temp=path.join(folder,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(record,null,2));await rename(temp,path.join(folder,'annotation.json'));
   return record;
  });
  this.writes.set(id,operation);try{return await operation;}finally{if(this.writes.get(id)===operation)this.writes.delete(id);}
 }
 async snapshot(id){const bytes=await readFile(path.join(this.folder(id),'capture.bin'));const record=await this.get(id);if(digest(bytes)!==record.files.capture.sha256)throw Error('Saved evidence hash mismatch');return unpack(bytes);}
 async file(id,name){
  if(!['capture.bin','atlas.png','composite.png','memory.bin','snapshot.json','annotation.json','comment.md','movie.bk2'].includes(name))throw Error('Unknown annotation file');
  if(name==='comment.md')return Buffer.from(markdownExport(await this.get(id)));
  return readFile(path.join(this.folder(id),name));
 }
}
