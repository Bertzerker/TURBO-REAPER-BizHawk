// SPDX-License-Identifier: MIT
// Run "native" against the isolated --catalog-stress HuCard, then "cold"
// against a freshly started server serving the same private diagnostic root.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {unpack,spriteSample} from '../protocol.mjs';
import {CatalogStore} from '../catalog.mjs';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const base=process.env.REA_URL??'http://127.0.0.1:8930';
const reportFile=new URL('test-output/catalog-report.json',root);
const fixtureHash='65a1ac4b3213c8da0b1435e28b27ce4d3c16a8b2ce5b2629a871c8d6e8c6273c';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const session=await (await fetch(base+'/api/session')).json();
const postHeaders={'X-REA-Token':session.token,'Content-Type':'application/json'};
async function request(route,body,status=200){
 const response=await fetch(base+route,body===undefined?{}:{method:'POST',headers:postHeaders,body:JSON.stringify(body)});
 assert.equal(response.status,status,response.status===status?route:route+' '+await response.text());
 return response;
}
const json=async(...args)=>(await request(...args)).json();
const binary=async route=>Buffer.from(await (await request(route)).arrayBuffer());
const command=async(action,options={})=>(await json('/api/control',{action,...options})).result;
const noteRoute=(id,file='')=>'/api/annotations/'+id+(file?'/'+file:'');
const report=async value=>writeFile(reportFile,JSON.stringify(value,null,2)+'\n');

if(process.argv[2]==='cold'){
 const saved=JSON.parse(await readFile(reportFile));
 const initial=await json('/api/session');
 assert.equal(initial.status.producerConnected,false,'Cold review must run without a producer');
 const catalog=await new CatalogStore(fileURLToPath(root)).read(saved.notes[0].tracking.game);
 for(const entry of Object.values(saved.catalog))assert.deepEqual(catalog.entries.find(row=>row.id===entry.id),entry);
 for(const expected of saved.notes){
  const note=await json(noteRoute(expected.id));
  assert.deepEqual(note.tracking,expected.tracking);
  assert.equal(note.category,expected.category);
  assert.equal(sha(await binary(noteRoute(note.id,'capture.bin'))),expected.tracking.capture.sha256);
  assert.equal(sha(await binary(noteRoute(note.id,'catalog-isolation.png'))),expected.isolationSha256);
  assert.equal(sha(await binary(noteRoute(note.id,'investigation.zip'))),expected.bundleSha256);
  if(expected.tracking.movie.archived)assert.equal(sha(await binary(noteRoute(note.id,'movie.bk2'))),saved.movie.sha256);
 }
 saved.coldReview=true;
 await report(saved);
 console.log(JSON.stringify({coldReview:true,notes:saved.notes.length}));
 process.exit(0);
}

assert.equal(session.status.live?.rom.mappedSha256.toLowerCase(),fixtureHash,'Launch the isolated original catalog diagnostic before testing');
const exact=async id=>unpack(await binary('/api/live?snapshot='+id));
const latest=async()=>exact((await json('/api/snapshot')).id);
async function step(frames=1,buttons){
 const result=await command('step',{frames,...(buttons?{buttons}:{})});
 return exact(result.snapshot);
}
const owners={sprite:randomUUID(),tile:randomUUID()};
const observe=(kind,action,args={},status=200)=>json('/api/catalog/observe',{owner:owners[kind],action,...args},status);
const catalogAt=s=>json('/api/catalog?snapshot='+s.meta.id);
const seedAt=(s,view,x,y)=>json('/api/catalog/pick?'+new URLSearchParams({snapshot:s.meta.id,view,x,y}));
const change=(s,revision,action,args,status=200)=>json('/api/catalog',{snapshot:s.meta.id,revision,action,...args},status);
const target=entry=>({id:entry.id,entryRevision:entry.revision});
const point=(s,slot,pattern)=>{
 for(let x=50;x<180;x++){
  const sample=spriteSample(s,x,48);
  if(sample?.slot===slot&&(pattern===undefined||sample.pattern===pattern))return {view:'obj',x,y:48};
 }
 return null;
};
const summarize=result=>({frame:result.frame,state:result.state,bounds:result.selection?.bounds,patterns:result.selection?.patterns});
const assertResult=(result,s,state)=>{assert.equal(result.snapshot,s.meta.id);assert.equal(result.state,state,result.reason);};

if(process.argv[2]==='measure'){
 const saved=JSON.parse(await readFile(reportFile));
 const tile=saved.catalog.tile,duration=5000;
 const results=[];
 for(const enabled of [false,true]){
  await command('pause');
  await command('catalog-capture',{enabled});
  const first=await step();
  if(enabled){
   const all=await observe('tile','all',{snapshot:first.meta.id,...target(tile)});
   const candidate=all.candidates.find(row=>row.batWord===104);
   assert(candidate);
   await observe('tile','pick',{snapshot:first.meta.id,...target(tile),candidate:candidate.id});
  }
  const before=await json('/api/metrics'),frames=[],times=[],states=[],transitions=[];
  await command('resume');
  const start=performance.now();
  try{
   do{
    const t=performance.now();
    if(enabled){
     const result=await observe('tile','advance',target(tile));
     times.push(performance.now()-t);
     if(states.at(-1)!==result.state)transitions.push({frame:result.frame,state:result.state,reason:result.reason});
     states.push(result.state);
    }
    frames.push(await json('/api/snapshot'));
    await delay(Math.max(0,75-(performance.now()-t)));
   }while(performance.now()-start<duration);
  }finally{await command('pause');}
  const after=await json('/api/metrics');
  const last=frames.at(-1),firstSample=frames[0];
  const p95=items=>{const sorted=[...items].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length*.95)];};
  results.push({enabled,elapsedMs:performance.now()-start,emulatedFrames:last.frame-firstSample.frame,
   received:after.received-before.received,invalid:after.invalid-before.invalid,dropped:after.dropped-before.dropped,skipped:last.skipped-firstSample.skipped,
   copyP95:p95(frames.map(f=>f.capture_ms)),encodeP95:p95(frames.map(f=>f.encode_ms)),observationP95:p95(times),following:states.filter(state=>state==='following').length,samples:frames.length,transitions,retained:after.retained,tracking:after.catalog,
   rssBefore:before.memory.rss,rssAfter:after.memory.rss});
  if(enabled)await observe('tile','release');
 }
 assert(results.every(row=>row.emulatedFrames>100&&row.invalid===0&&row.retained<=16));
 assert(results[1].following===results[1].samples,'The selected BAT occurrence must follow throughout continuous play: '+JSON.stringify(results));
 const activeReplay=[];
 await command('play',{name:saved.movie.name});
 await command('speed',{percent:10});
 try{
  const frame=await step(3);
  const selected={
   sprite:await select('sprite',saved.catalog.sprite,frame),
   tile:await select('tile',tile,frame)
  };
  const pins={sprite:await pin('sprite',selected.sprite),tile:await pin('tile',selected.tile)};
  await command('resume');
  for(let attempt=0;attempt<30;attempt++){
   const now=(await json('/api/session')).status.live;
   if(!now.paused&&now.frame>frame.meta.frame)break;
   await delay(60);
  }
  for(const kind of ['sprite','tile']){
   const before=(await json('/api/session')).status.live;
   assert(!before.paused&&before.frame>frame.meta.frame&&before.movie.mode==='PLAY');
   const note=await json('/api/annotations/capture',{tracking:pins[kind],category:kind==='sprite'?'bug':'observation'},201);
   const after=(await json('/api/session')).status.live;
   assert(!after.paused&&after.frame>=before.frame&&after.movie.mode==='PLAY');
   assert.equal(note.snapshot.id,selected[kind].snapshot);
   assert.equal(note.movie.sha256,saved.movie.sha256);
   activeReplay.push({kind,id:note.id,savedFrame:note.snapshot.frame,playhead:after.frame,readOnly:after.movie.readOnly});
  }
 }finally{
  await command('pause');
  await command('speed',{percent:100});
  await command('movie-stop');
 }
 assert.equal(sha(await readFile(new URL('movies/'+saved.movie.name+'.bk2',root))),saved.movie.sha256);
 await report({...saved,continuous:results,activeReplay});
 console.log(JSON.stringify({continuous:results,activeReplay}));
 process.exit(0);
}

await command('pause');
let s=await step(2);
const suffix=Date.now(),checkpoint='catalog-start-'+suffix;
await command('checkpoint-save',{name:checkpoint});
let catalog=await catalogAt(s);
const first=point(s,1,64);
assert(first,'The stationary duplicate must be visible');
const spriteSeed=await seedAt(s,first.view,first.x,first.y);
assert.equal(spriteSeed.evidenceClass,'admitted-sprite-raster');
assert.equal(spriteSeed.locator.slot,1);
let reply=await change(s,catalog.revision,'create',{...first,name:'Diagnostic animation '+suffix,labels:['diagnostic']});
catalog=reply.catalog;
let sprite=catalog.entries.find(entry=>entry.id===reply.selected);
let alternate;
for(let n=0;n<16&&!alternate;n++){s=await step();alternate=point(s,0,65);}
assert(alternate,'The moving sprite must display its second pattern');
const alternateSeed=await seedAt(s,alternate.view,alternate.x,alternate.y);
assert.equal(alternateSeed.selector.pattern,65);
const oldRevision=catalog.revision;
reply=await change(s,oldRevision,'append',{...alternate,id:sprite.id});
catalog=reply.catalog;
sprite=catalog.entries.find(entry=>entry.id===reply.selected);
assert.deepEqual(sprite.selectors.map(selector=>selector.pattern),[64,65]);
await change(s,oldRevision,'edit',{id:sprite.id,name:'Stale edit',selectors:sprite.selectors},409);
const tileSeed=await seedAt(s,'bg1',64,30);
assert.equal(tileSeed.evidenceClass,'render-time-bat');
assert.deepEqual([tileSeed.locator.pattern,tileSeed.locator.batWord],[64,104]);
reply=await change(s,catalog.revision,'create',{view:'bg1',x:64,y:30,name:'Repeated tile '+suffix});
catalog=reply.catalog;
const tile=catalog.entries.find(entry=>entry.id===reply.selected);
const wrongGame={...catalog,game:{...catalog.game,digest:{algorithm:'sha256',value:'f'.repeat(64)}}};
await change(s,catalog.revision,'import',{catalog:wrongGame},400);
assert.equal((await catalogAt(s)).revision,catalog.revision);
const bat=await seedAt(s,'bat',64,30);
assert.equal(bat.evidenceClass,'boundary-bat-diagnostic');

async function select(kind,entry,frame){
 const all=await observe(kind,'all',{snapshot:frame.meta.id,...target(entry)});
 assertResult(all,frame,'all');
 assert(all.candidates.length>1);
 const candidate=all.candidates.find(row=>kind==='sprite'?row.slot===0:row.batWord===104&&row.bounds.y<=30&&row.bounds.y+row.bounds.height>30);
 assert(candidate,'The original locator must be in the candidate list');
 const result=await observe(kind,'pick',{snapshot:frame.meta.id,...target(entry),candidate:candidate.id});
 assertResult(result,frame,'following');
 assert(result.image);
 return result;
}
async function advance(kind,entry,frame,state='following'){
 const result=await observe(kind,'advance',target(entry));
 // A periodic paused capture can republish the same native render with a new
 // sequence. The result must still carry the completed frame and fresh proof.
 assert.equal(result.frame,frame.meta.frame);
 assert.equal(result.state,state,result.reason);
 return result;
}
async function pin(kind,result){
 const pinned=await observe(kind,'pin',{ticket:result.ticket});
 assert.equal(pinned.snapshot,result.snapshot);
 return {owner:owners[kind],ticket:pinned.ticket};
}
const notes=[];
async function attach(result,tracking,category){
 const before=(await json('/api/session')).status.live;
 const saved=await json('/api/annotations/capture',{tracking,category},201);
 const after=(await json('/api/session')).status.live;
 assert.equal(after.frame,before.frame,'Saving a tracked note moved the playhead');
 assert.equal(after.paused,before.paused);
 assert.equal(saved.category,category);
 assert.equal(saved.snapshot.id,result.snapshot);
 assert.equal(saved.tracking.capture.frame,result.frame);
 assert.deepEqual(saved.tracking.selection,result.selection);
 assert.equal(saved.tracking.capture.sha256,sha(await binary(noteRoute(saved.id,'capture.bin'))));
 assert.equal(saved.files['catalog-isolation.png'].sha256,sha(Buffer.from(result.image,'base64')));
 assert.deepEqual(await json(noteRoute(saved.id,'catalog-observation.json')),saved.tracking);
 return saved;
}

// Both entries are selected in an ordinary live machine, with independent
// leases. Read-only observations may run between native completed frames.
await command('checkpoint-load',{name:checkpoint});
s=await step(1);
const liveSprite=await select('sprite',sprite,s),liveTile=await select('tile',tile,s);
const liveProof=[await pin('sprite',liveSprite),await pin('tile',liveTile)];
const motion=[summarize(liveSprite)];
const tileMotion=[summarize(liveTile)];
let lost;
for(let n=0;n<16;n++){
 s=await step();
 const state=await observe('sprite','advance',target(sprite));
 motion.push(summarize(state));
 tileMotion.push(summarize(await advance('tile',tile,s)));
 if(state.state==='lost'){lost=state;break;}
}
assert(motion.some(row=>row.state==='missing'));
assert(lost,'A returning SATB slot must require a re-pick');
assert(motion.some(row=>row.patterns?.includes(65)),'Follow must survive the cataloged animation change');
assert(new Set(motion.map(row=>row.bounds?.x).filter(x=>x!==undefined)).size>1,'Follow must preserve motion');
await step(20);
assert(!(await json('/api/history')).some(row=>row.id===liveSprite.snapshot),'Pinned proof should outlive stream history');
const liveNotes=[await attach(liveSprite,liveProof[0],'observation'),await attach(liveTile,liveProof[1],'bug')];

// Compare state and composite with catalog attribution disabled/enabled.
const integrity=[];
for(const enabled of [false,true]){
 await command('checkpoint-load',{name:checkpoint});
 await command('catalog-capture',{enabled});
 const frame=await step(6,{'P1 Right':true});
 assert.equal(frame.meta.raster.spriteEncoding==='pce-obj-v2',enabled);
 integrity.push({state:(await command('state-hash')).sha256,output:sha(await binary('/api/image?view=composite&snapshot='+frame.meta.id))});
}
assert.deepEqual(integrity[0],integrity[1]);

// Record once, then validate two read-only replays and exact attachment of
// sprite and tile observations after the replay has advanced.
const name='catalog-movie-'+suffix;
await command('record',{name,start:'poweron'});
await step(2,{'P1 B1':true});
await step(45,{'P1 Right':true});
await command('movie-save');
const inputRows=await command('movie-inputs',{start:0,length:20});
await command('movie-stop');
const movieFile=new URL('movies/'+name+'.bk2',root);
const movieBytes=await readFile(movieFile),movieSha256=sha(movieBytes),replays=[];
let replayNotes;
for(let trial=0;trial<2;trial++){
 await command('play',{name});
 s=await step(3);
 assert.equal(s.meta.movie.mode,'PLAY');
 assert.equal(s.meta.movie.readOnly,true);
 assert.equal(s.meta.movie.sourceSha256.toLowerCase(),movieSha256);
 assert.deepEqual(await command('movie-inputs',{start:0,length:20}),inputRows);
 const trace=[];
 await select('sprite',sprite,s);
 await select('tile',tile,s);
 for(let n=0;n<4;n++){
  s=await step();
  const obj=await advance('sprite',sprite,s),bg=await advance('tile',tile,s);
  trace.push([summarize(obj),summarize(bg)]);
 }
 const obj=await advance('sprite',sprite,s),bg=await advance('tile',tile,s);
 const proof=[await pin('sprite',obj),await pin('tile',bg)];
 const later=await step(20);
 assert(later.meta.movie.timelineFrame>obj.movie.timelineFrame);
 if(trial===0){
  replayNotes=[await attach(obj,proof[0],'bug'),await attach(bg,proof[1],'observation')];
  for(const note of replayNotes){
   assert.equal(note.tracking.movie.archived,true);
   assert.equal(note.tracking.movie.sha256,movieSha256);
   assert.equal(note.tracking.movie.previousInputRow,note.tracking.movie.timelineFrame-1);
   assert.deepEqual(await binary(noteRoute(note.id,'movie.bk2')),movieBytes);
  }
  await command('play',{name});
  s=await step(3);
  await advance('sprite',sprite,s,'lost');
  await advance('tile',tile,s,'lost');
 }
 replays.push(trace);
 await command('movie-stop');
 assert.deepEqual(await readFile(movieFile),movieBytes);
}
assert.deepEqual(replays[0],replays[1]);
for(const [obj,bg] of replays[0]){
 assert.deepEqual(obj,motion.find(row=>row.frame===obj.frame));
 assert.deepEqual(bg,tileMotion.find(row=>row.frame===bg.frame));
}

s=await latest();
catalog=await catalogAt(s);
const revised=await change(s,catalog.revision,'edit',{id:sprite.id,name:'Edited animation '+suffix,selectors:[sprite.selectors[0]]});
const savedSprite=revised.catalog.entries.find(entry=>entry.id===sprite.id);
assert(savedSprite.revision>sprite.revision);
for(const original of [...liveNotes,...replayNotes]){
 const saved=await json(noteRoute(original.id));
 assert.deepEqual(saved.tracking,original.tracking);
 const file=await binary(noteRoute(saved.id,'investigation.zip'));
 await writeFile(new URL('test-output/catalog-'+saved.id+'.zip',root),file);
 notes.push({id:saved.id,category:saved.category,tracking:saved.tracking,isolationSha256:saved.files['catalog-isolation.png'].sha256,bundleSha256:sha(file)});
}
const metrics=await json('/api/metrics');
assert(metrics.retained<=16&&metrics.catalog.retainedResults<=Object.keys(owners).length*3);
await report({ok:true,fixtureHash,motion,tileMotion,integrity,replays,movie:{name,sha256:movieSha256,bytes:movieBytes.length},notes,catalog:{sprite:savedSprite,tile},metrics});
console.log(JSON.stringify({ok:true,notes:notes.map(note=>({id:note.id,kind:note.tracking.entry.kind,frame:note.tracking.capture.frame,movie:note.tracking.movie.archived})),motion:motion.length,movieSha256}));
