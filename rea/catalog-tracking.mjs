// SPDX-License-Identifier: MIT
import {randomUUID} from 'node:crypto';
import {catalogGame,scanMatches,isolatedPixels,sha256,uuid} from './catalog.mjs';

const ttl=120000,maxOwners=8,maxHistory=16;
const error=(message,status=400)=>Object.assign(Error(message),{status});
const scope=m=>JSON.stringify([
 m.session,m.continuity,m.rom.mappedSha256,m.core,m.identity?.sync,
 m.geometry?.width,m.geometry?.height,m.geometry?.topLine,m.geometry?.bottomLine,
 m.movie?.loaded,m.movie?.mode,m.movie?.filename,m.movie?.sourceSha256,m.movie?.readOnly,m.movie?.rerecords
]);
const center=c=>c.origin??{x:c.bounds.x+c.bounds.width/2,y:c.bounds.y+c.bounds.height/2};
function distance(a,b){
 const first=center(a),second=center(b);
 return Math.max(Math.abs(first.x-second.x),Math.abs(first.y-second.y));
}

function follow(previous,scan,delta){
 if(previous.state==='lost'||previous.state==='ambiguous')return previous;
 if(scan.reason)return {...previous,state:'lost',reason:scan.reason};
 const old=previous.candidate;
 const radius=Math.min(24,Math.max(8,delta*6));
 const sameLocator=scan.candidates.filter(c=>old.slot!==undefined?c.slot===old.slot:c.batWord===old.batWord);
 const near=sameLocator.filter(c=>distance(old,c)<=radius);
 if(!sameLocator.length)return {...previous,state:'missing',reason:'The selected locator has no admitted match. Re-pick after occlusion.'};
 if(previous.state==='missing'||!near.length)return {...previous,state:'lost',reason:'The locator disappeared or moved beyond the continuity bound. Re-pick the instance.'};
 if(near.length!==1||old.slot!==undefined&&scan.candidates.some(c=>c!==near[0]&&distance(old,c)<=radius)){
  return {...previous,state:'ambiguous',reason:'More than one matching instance is within the continuity bound. Re-pick the instance.'};
 }
 if(old.slot!==undefined&&old.flags!==near[0].flags){
  return {...previous,state:'lost',reason:'The SATB slot changed size, flip, priority or color mode. Re-pick the instance.'};
 }
 return {state:'following',candidate:near[0]};
}

export class CatalogTracking {
 constructor(png){this.png=png;this.owners=new Map();}
 expire(){
  const now=Date.now();
  for(const [owner,row] of this.owners)if(row.expires<now)this.owners.delete(owner);
 }
 row(owner,create=false){
  if(!uuid(owner))throw error('Invalid catalog viewer');
  this.expire();
  let row=this.owners.get(owner);
  if(!row&&create){
   if(this.owners.size>=maxOwners)throw error('Catalog viewer limit reached. Close an unused catalog viewer.',429);
   row={results:[],expires:Date.now()+ttl};
   this.owners.set(owner,row);
  }
  if(!row)throw error('Catalog view expired. Show all matches or re-pick.',404);
  row.expires=Date.now()+ttl;
  return row;
 }
 release(owner){if(!uuid(owner))throw error('Invalid catalog viewer');this.owners.delete(owner);}
 evidence(owner,ticket,pin=false){
  const row=this.row(owner);
  const result=row.pinned?.ticket===ticket?row.pinned:row.results.find(item=>item.ticket===ticket);
  if(!result)throw error('Tracked frame expired. Pin a fresh observation.',404);
  if(pin)row.pinned=result;
  return result;
 }
 measure(){this.expire();return {viewers:this.owners.size,retainedResults:[...this.owners.values()].reduce((n,row)=>n+row.results.length+Number(!!row.pinned),0)};}
 observe(input,s,catalog,history){
  const entry=catalog.entries.find(entry=>entry.id===input.id);
  if(!entry||entry.revision!==input.entryRevision)throw error('Catalog entry changed. Reload and re-pick.',409);
  if(!['all','pick','advance'].includes(input.action))throw error('Unknown catalog observation action');
  const row=this.row(input.owner,input.action!=='advance');
  if(input.action==='advance'&&(row.entry?.id!==entry.id||row.entry?.revision!==entry.revision)){
   throw error('Catalog selection changed. Show all matches or re-pick.',409);
  }
  const m=s.meta;
  const currentScope=scope(m);
  let track=input.action==='advance'?row.track:null;
  const batLocator=track?.candidate.batWord;
  const scan=scanMatches(s,entry,{keepPixels:true,batLocator});
  if(input.action==='pick'){
   if(scan.evidenceClass==='boundary-bat-diagnostic')throw error('BAT diagnostics support isolation only. Pick a rendered Background tile to follow.');
   if(scan.reason)throw error(scan.reason);
   const candidate=scan.candidates.find(c=>c.id===input.candidate);
   if(!candidate)throw error('The selected candidate is absent from that exact frame',409);
   track={state:'following',candidate};
  }else if(track&&m.id!==row.previous.id){
   const past=history.filter(frame=>frame.meta.sequence>row.previous.sequence&&frame.meta.sequence<m.sequence);
   const frames=[...past,s];
   let previous=row.previous;
   for(const frame of frames){
    const next=frame.meta,delta=next.frame-previous.frame;
    const reset=currentScope!==row.scope||scope(next)!==row.scope||delta<0;
    const gap=next.sequence!==previous.sequence+1||delta>4||frames.length>maxHistory;
    if(reset||gap){
     const reason=reset?'The ROM, geometry, state or replay changed.':'Required captures expired or did not arrive.';
     track={...track,state:'lost',reason:reason+' Re-pick the instance.'};
     break;
    }
    if(delta>0||!next.raster?.valid)track=follow(track,frame===s?scan:scanMatches(frame,entry,{batLocator}),delta);
    previous=next;
   }
  }
  if(scan.reason&&track?.state==='following')track={...track,state:'lost',reason:scan.reason};
  row.entry=entry;
  row.track=track;
  row.scope=currentScope;
  row.previous={id:m.id,sequence:m.sequence,frame:m.frame};
  row.expires=Date.now()+ttl;
  const selected=track?.state==='following'?track.candidate:null;
  const state=track?.state??(scan.reason?'unsupported':'all');
  const reason=track?.reason??scan.reason;
  if(selected)row.lastConfirmed={capture:m.id,frame:m.frame,instance:selected};
  else if(!track)row.lastConfirmed=null;
  let image=null;
  if(scan.pixels&&(!track||selected)){
   const payload=isolatedPixels(s,scan,selected);
   image=this.png({meta:{atlas:{width:scan.width,height:scan.height,offset:0}},payload});
  }
  const ticket=randomUUID();
  const attachment={
   schema:1,game:catalogGame(m),catalogRevision:catalog.revision,entry,
   selectorSha256:sha256(JSON.stringify(entry.selectors)),
   capture:{id:m.id,frame:m.frame,sha256:sha256(s.packet),core:m.core,version:m.version,identity:m.identity},
   evidenceClass:scan.evidenceClass,state,reason,view:scan.view,
   width:scan.width,height:scan.height,selection:selected,lastConfirmed:row.lastConfirmed,
   candidates:track?(selected?[selected]:[]):scan.candidates,
   movie:{...m.movie,filename:m.movie?.filename?.split(/[\\/]/).at(-1)??'',previousInputRow:m.movie?.timelineFrame>0?m.movie.timelineFrame-1:null}
  };
  const result={ticket,s,attachment,image};
  row.results.push(result);
  if(row.results.length>2)row.results.shift();
  return {
   ticket,snapshot:m.id,frame:m.frame,movie:attachment.movie,state,reason,
   evidenceClass:scan.evidenceClass,view:scan.view,width:scan.width,height:scan.height,
   entryId:entry.id,entryRevision:entry.revision,
   candidates:scan.candidates,selection:selected,
   image:image?.toString('base64')??null
  };
 }
}
