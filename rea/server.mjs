// SPDX-License-Identifier: MIT
import http from 'node:http';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,readFile,readdir,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {Framer,range,inspectPixel,logicalAddress} from './protocol.mjs';
import {WordRuns} from './public/transport.mjs';
import {Annotations} from './annotations.mjs';
import {comparisonReason,checkpointReason} from './public/model.mjs';
import {investigation} from './bundle.mjs';
import {CatalogStore,catalogGame,pickCatalog,sha256} from './catalog.mjs';
import {CatalogTracking} from './catalog-tracking.mjs';

export function streamPacket(s,encoder=new WordRuns()){
 // Keep sprite attribution and BAT row records on the server for exact lookups.
 const end=s.meta.raster?.offset??s.payload.length,raw=s.payload.subarray(0,end),encoded=encoder.encode(raw);
 const meta={...s.meta,tileRows:s.meta.tileRows?{available:true,streamed:false}:undefined,raster:s.meta.raster?{...s.meta.raster,length:0,streamed:false}:undefined,transport:{codec:encoded.codec,rawLength:raw.length,encodedLength:encoded.bytes.length}};
 const json=Buffer.from(JSON.stringify(meta)),prefix=Buffer.alloc(4);prefix.writeUInt32LE(json.length);
 return Buffer.concat([prefix,json,encoded.bytes]);
}

export function websocketFrame(payload,opcode=2){
 let head;
 if(payload.length<126){head=Buffer.from([128|opcode,payload.length]);}
 else if(payload.length<65536){head=Buffer.alloc(4);head[0]=128|opcode;head[1]=126;head.writeUInt16BE(payload.length,2);}
 else{head=Buffer.alloc(10);head[0]=128|opcode;head[1]=127;head.writeBigUInt64BE(BigInt(payload.length),2);}
 return Buffer.concat([head,payload]);
}
let crcTable;
function crc32(b){crcTable??=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});let c=0xffffffff;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function pngChunk(type,bytes){const t=Buffer.from(type),out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);t.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([t,bytes])),out.length-4);return out;}
export function png(s,view='atlas'){
 let {width,height,offset}=s.meta.atlas,px=0,py=0,stride=width;
 if(view!=='atlas'){
  if(view==='tiles'){({width,height,offset}=s.meta.tiles);stride=width;}
  else {const p=s.meta.atlas.panels.find(p=>p.view===view);if(!p)throw Error('Unknown view');({width,height,x:px,y:py}=p);}
 }
 const data=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const src=offset+((py+y)*stride+px+x)*4,dst=y*(width*4+1)+1+x*4;
  data[dst]=s.payload[src+2];data[dst+1]=s.payload[src+1];data[dst+2]=s.payload[src];data[dst+3]=view==='composite'?255:s.payload[src+3];
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(data)),pngChunk('IEND',Buffer.alloc(0))]);
}
export async function start({port=8920,streamPort=8921,root=path.dirname(fileURLToPath(import.meta.url)),nativeToken=process.env.REA_TG16_NATIVE_TOKEN??randomUUID(),leaseMs=120000}={}){
 const romAsset=process.env.REA_TG16_ROM?await readFile(process.env.REA_TG16_ROM):null,romSha1=romAsset?createHash('sha1').update(romAsset).digest('hex').toUpperCase():null,romSha256=romAsset?createHash('sha256').update(romAsset).digest('hex'):null;
 const history=new Map(),pinned=new Map(),held=new Map(),clients=new Set(),requests=new Map(),viewers=new Map(),pinVersions=new Map();
 let latest,bridge,received=0,invalid=0,dropped=0,startTime=Date.now(),lastFrameAt=0,lastStream,producerEpoch=0,latestEpoch=-1;
 const cadence=[],captureTimes=[];
 const encoder=new WordRuns();let streamBytes=0,sourceBytes=0,pipelineMs=0;
 const token=randomUUID();
 const deadlines=new Map();const expire=()=>{for(const [key,end]of deadlines)if(end<Date.now()){held.delete(key);deadlines.delete(key);pinVersions.delete(key);}};
 const notes=new Annotations(root,png),snapshotWaiters=new Map();
 const catalogs=new CatalogStore(root),tracking=new CatalogTracking(png);
 const stats=()=>({memory:process.memoryUsage(),received,invalid,dropped,averageCapturedFps:received/((Date.now()-startTime)/1000),capturedFps:captureTimes.length>1?(captureTimes.length-1)/((captureTimes.at(-1)-captureTimes[0])/1000):0,lastFrameAgeMs:lastFrameAt?Date.now()-lastFrameAt:null,bridge:!!bridge,streamPort,latest:latest?.meta.id,retained:history.size,pinned:pinned.size,held:held.size,streamBytes,sourceBytes,pipelineMs,pending:[...requests.values()].map(r=>r.action),emulatedFps:cadence.length>1&&!latest?.meta.paused?(cadence.at(-1).frame-cadence[0].frame)/((cadence.at(-1).at-cadence[0].at)/1000):0,viewers:[...viewers.values()].filter(v=>Date.now()-v.at<10000)});
 const sessionStatus=()=>{const age=lastFrameAt?Date.now()-lastFrameAt:null,current=!!bridge&&latestEpoch===producerEpoch,live=current?latest?.meta:null;return {server:true,producerConnected:!!bridge,producerEpoch,live,lastCapture:latest?{id:latest.meta.id,frame:latest.meta.frame,ageMs:age,nativeValid:!!latest.meta.raster?.valid,fromCurrentProducer:current,stale:!current||age>2000}:null};};
 const publish=s=>{
  if(s.meta.type==='reply'){const r=requests.get(s.meta.requestId);if(r){clearTimeout(r.timer);requests.delete(s.meta.requestId);r.resolve(s.meta);}return;}
  latest=s;latestEpoch=producerEpoch;received++;captureTimes.push(Date.now());while(captureTimes.length>1&&captureTimes[0]<Date.now()-2000)captureTimes.shift();lastFrameAt=Date.now();history.set(s.meta.id,s);while(history.size>16)history.delete(history.keys().next().value);
  if(!s.meta.paused){if(cadence.length&&s.meta.frame<=cadence.at(-1).frame)cadence.length=0;cadence.push({frame:s.meta.frame,at:Date.now()});while(cadence.length>1&&cadence[0].at<Date.now()-2000)cadence.shift();}else cadence.length=0;
  for(const resolve of snapshotWaiters.get(s.meta.id)??[])resolve(s);snapshotWaiters.delete(s.meta.id);
  const started=performance.now();lastStream=streamPacket(s,encoder);streamBytes+=lastStream.length;sourceBytes+=s.packet.length;pipelineMs=performance.now()-started;
  const msg=websocketFrame(lastStream);
  for(const c of clients){if(c.pendingFrames>=6){dropped++;continue;}c.pendingFrames++;c.write(msg,()=>{c.pendingFrames--;});}
 };
 const producerSockets=new Set();
 const ingest=net.createServer(socket=>{
  if(bridge||producerSockets.size>=2){socket.destroy();return;}producerSockets.add(socket);socket.setNoDelay(true);socket.setTimeout(5000,()=>socket.destroy());
  let admitted=false;
  const framer=new Framer(s=>{
   if(!admitted){if(s.meta.type!=="hello"||s.meta.token!==nativeToken||bridge)throw Error("Producer authentication failed");admitted=true;bridge=socket;producerEpoch++;cadence.length=0;socket.setTimeout(0);return;}
   publish(s);
  });
  socket.on('data',b=>{try{framer.push(b);}catch{invalid++;socket.destroy();}});
  socket.on('error',()=>{});socket.on('close',()=>{producerSockets.delete(socket);if(bridge!==socket)return;bridge=null;for(const r of requests.values()){clearTimeout(r.timer);r.reject(Error('Emulator bridge disconnected'));}requests.clear();});
 });
 const getSnapshot=(params,pin=false)=>{
  expire();const id=params.get('snapshot');const s=id?(pinned.get(id)||history.get(id)||[...held.values()].find(s=>s.meta.id===id)):latest;
  if(!s)throw Object.assign(Error('Snapshot is unavailable or expired'),{status:404});
  if(pin){pinned.delete(s.meta.id);pinned.set(s.meta.id,s);while(pinned.size>16)pinned.delete(pinned.keys().next().value);}
  return s;
 };
 const sendCommand=command=>new Promise((resolve,reject)=>{
  if(!bridge)return reject(Error('Emulator bridge is disconnected'));
  if(requests.size>=8)return reject(Error('Too many pending commands'));
  const requestId=randomUUID(),timer=setTimeout(()=>{requests.delete(requestId);reject(Error('Command timed out; inspect emulator state before retrying'));},90_000);
  requests.set(requestId,{resolve,reject,timer,action:command.action});bridge.write(JSON.stringify({...command,requestId})+'\n');
 });
 const waitSnapshot=id=>history.has(id)?Promise.resolve(history.get(id)):pinned.has(id)?Promise.resolve(pinned.get(id)):new Promise((resolve,reject)=>{
  const done=s=>{clearTimeout(timer);resolve(s);},timer=setTimeout(()=>{const list=snapshotWaiters.get(id);if(list){const i=list.indexOf(done);if(i>=0)list.splice(i,1);if(!list.length)snapshotWaiters.delete(id);}reject(Error('Rendered snapshot did not arrive'));},5000);
  snapshotWaiters.set(id,[...(snapshotWaiters.get(id)??[]),done]);
 });
 const allowed=new Set(['pause','resume','speed','step','record','movie-save','movie-stop','play','checkpoint-save','checkpoint-load','tastudio','capture-rate','raster-enable','catalog-capture','state-hash','movie-inputs','shutdown']);
 const safeHost=h=>h===`127.0.0.1:${server.address()?.port}`||h===`localhost:${server.address()?.port}`;
 const evidence=async(p,prefix='')=>p.get(prefix+'Note')?notes.snapshot(p.get(prefix+'Note')):getSnapshot(new URLSearchParams({snapshot:p.get(prefix)||p.get('snapshot')||''}),true);
 const exportBundle=async(s,noteId=null)=>{
  if(noteId){const note=await notes.get(noteId),names=['capture.bin','memory.bin','atlas.png','composite.png','snapshot.json','annotation.json','comment.md',...(note.movie.archived?['movie.bk2']:[]),...['catalog-observation.json','catalog-isolation.png'].filter(name=>note.files[name])],files=Object.fromEntries(await Promise.all(names.map(async n=>[n,await notes.file(noteId,n)])));return investigation(files,s.meta,note);}
  return investigation({'capture.bin':s.packet,'memory.bin':s.payload.subarray(0,s.meta.atlas.offset),'atlas.png':png(s),'composite.png':png(s,'composite'),'snapshot.json':JSON.stringify(s.meta,null,2),'note.md':'Unannotated evidence capture. Create a frame comment to attach notes and an archived movie version.\n'},s.meta);
 };
 const checkpointList=async()=>Promise.all((await readdir(path.join(root,'checkpoints')).catch(()=>[])).filter(n=>n.endsWith('.State.json')).map(async filename=>{
  const name=filename.slice(0,-11),info=JSON.parse(await readFile(path.join(root,'checkpoints',filename),'utf8')),live=sessionStatus().live;
  const reason=checkpointReason(info,live);
  return {name,...info,compatible:!reason,reason,lifetime:'Persistent disk checkpoint',warnings:info.native?[]:['Native binary identity was not recorded in this legacy checkpoint'],bytes:(await stat(path.join(root,'checkpoints',filename.slice(0,-5)))).size};
 }));
 const exactCapture=id=>{
  if(typeof id!=='string'||!/^([a-f0-9]{32})-\d+$/.test(id))throw Error('An exact capture ID is required');
  return getSnapshot(new URLSearchParams({snapshot:id}));
 };
 async function sameMovieFile(filename,local){
  const resolved=await realpath(filename).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(!resolved)return false;
  const expected=await realpath(local).catch(e=>{if(e.code!=='ENOENT')throw e;});
  return process.platform==='win32'?resolved.toLowerCase()===expected?.toLowerCase():resolved===expected;
 }
 async function archiveReplay(movie){
  if(!movie?.sourceSha256)return null;
  const base=path.basename(movie.filename),local=path.resolve(root,'movies',base);
  if(!base.endsWith('.bk2'))return null;
  const info=await lstat(local).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(!info?.isFile()||info.size>64*1024*1024)return null;
  if(!await sameMovieFile(movie.filename,local))return null;
  const bytes=await readFile(local);
  return sha256(bytes)===movie.sourceSha256.toLowerCase()?bytes:null;
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; object-src 'none'");
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try{
   if(!safeHost(req.headers.host))return json({error:'Invalid Host'},403);
   const origin=req.headers.origin;
   if(origin&&origin!==`http://${req.headers.host}`)return json({error:'Invalid Origin'},403);
   const url=new URL(req.url,`http://${req.headers.host}`),p=url.searchParams;
   const noteRoute=url.pathname.match(/^\/api\/annotations\/([a-f0-9-]{36})(?:\/([a-z0-9.-]+))?$/);
   if(req.method==='POST'&&['/api/catalog','/api/catalog/observe'].includes(url.pathname)){
    if(req.headers['x-rea-token']!==token)return json({error:'Missing control token'},403);
    if(!(req.headers['content-type']??'').startsWith('application/json'))return json({error:'Expected JSON'},415);
    let body='';
    for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>550000)throw Error('Catalog request is too large');}
    const input=JSON.parse(body);
    if(url.pathname==='/api/catalog'){
     const s=exactCapture(input.snapshot),game=catalogGame(s.meta);
     const seed=['create','append'].includes(input.action)?pickCatalog(s,input.view,input.x,input.y):null;
     return json(await catalogs.change(game,input,seed));
    }
    if(input.action==='release'){tracking.release(input.owner);return json({ok:true});}
    if(input.action==='pin'){
     const result=tracking.evidence(input.owner,input.ticket,true);
     return json({ticket:result.ticket,snapshot:result.s.meta.id});
    }
    const s=input.action==='advance'?((bridge&&latestEpoch===producerEpoch)?latest:null):exactCapture(input.snapshot);
    if(!s)return json({error:'No current producer capture. Re-pick after reconnecting.'},409);
    const catalog=await catalogs.read(catalogGame(s.meta));
    return json(tracking.observe(input,s,catalog,[...history.values()]));
   }
   if(req.method==='POST'&&['/api/pin','/api/unpin'].includes(url.pathname)){
    expire();if(req.headers['x-rea-token']!==token)return json({error:'Missing control token'},403);
    let body='';for await(const b of req){body+=b;if(body.length>4096)throw Error('Pin request too large');}const c=JSON.parse(body);
    if(!/^[a-f0-9-]{36}$/.test(c.owner)||!['evidence','baseline'].includes(c.slot)||!Number.isSafeInteger(c.generation)||c.generation<0)throw Error('Invalid evidence lease');
    const key=c.owner+':'+c.slot,previous=pinVersions.get(key)??-1;if(c.generation<previous)return json({error:'Superseded pin request'},409);
    if(url.pathname==='/api/unpin'){pinVersions.set(key,c.generation);held.delete(key);return json({ok:true});}
    const s=getSnapshot(new URLSearchParams({snapshot:c.snapshot}));if(!held.has(key)&&held.size>=16)return json({error:'Evidence lease limit reached; release an existing lease'},429);
    pinVersions.set(key,c.generation);held.set(key,s);deadlines.set(key,Date.now()+leaseMs);return json({ok:true,snapshot:s.meta.id,frame:s.meta.frame,expiresInMs:leaseMs});
   }
   if(req.method==='POST'&&(url.pathname==='/api/annotations/capture'||noteRoute&&!noteRoute[2])){
    expire();if(req.headers['x-rea-token']!==token)return json({error:'Missing control token'},403);
    if(!(req.headers['content-type']??'').startsWith('application/json'))return json({error:'Expected JSON'},415);
    let body='';for await(const b of req){body+=b;if(body.length>450000)throw Error('Comment request too large');}const input=JSON.parse(body);
    if(noteRoute)return json(await notes.update(noteRoute[1],input));
    let s,tracked=null,originalNote=null;
    if(input.tracking){
     if(input.annotation||input.snapshot)throw Error('Use the exact tracked frame as the comment source');
     tracked=tracking.evidence(input.tracking.owner,input.tracking.ticket,true);
     s=tracked.s;
    }
    else if(input.annotation){
     originalNote=await notes.get(input.annotation);
     s=await notes.snapshot(input.annotation);
     if(originalNote.tracking)tracked={attachment:originalNote.tracking,image:originalNote.files['catalog-isolation.png']?await notes.file(input.annotation,'catalog-isolation.png'):null};
    }
    else if(input.snapshot)s=getSnapshot(new URLSearchParams({snapshot:input.snapshot}),true);
    else {const reply=await sendCommand({action:'pause'});if(!reply.ok)throw Error(reply.result?.error??'Pause failed');s=await waitSnapshot(reply.result.snapshot);}
    if(!s.meta.raster?.valid)throw Error('Render a complete native frame before commenting');
    let movieCopy=originalNote?.movie.archived?await notes.file(input.annotation,'movie.bk2'):null;
    if(s.meta.movie?.loaded&&!movieCopy&&s.meta.movie.sourceSha256)movieCopy=await archiveReplay(s.meta.movie);
    if(s.meta.movie?.loaded&&!movieCopy&&!tracked&&!s.meta.movie.sourceSha256){
     const filename=s.meta.movie.filename,base=filename.split(/[\\/]/).at(-1),local=path.resolve(root,'movies',base);
     const same=latest?.meta.movie?.filename===filename&&latest?.meta.movie?.rerecords===s.meta.movie.rerecords;
     if(same&&latest.meta.movie.mode==='RECORD'){
      const saved=await sendCommand({action:'movie-save'});if(!saved.ok)throw Error(saved.result?.error??'Movie save failed');await waitSnapshot(saved.result.snapshot);
     }
     if(same&&base.endsWith('.bk2')&&await sameMovieFile(filename,local))movieCopy=await readFile(local);
    }
    const category=input.category??'observation';
    if(!['observation','bug','hypothesis','question'].includes(category))throw Error('Unsupported comment type');
    return json(await notes.capture(s,movieCopy,tracked,category),201);
   }
   if(req.method==='POST'&&url.pathname==='/api/viewer'){
    if(req.headers['x-rea-token']!==token)return json({error:'Missing control token'},403);
    let body='';for await(const b of req){body+=b;if(body.length>8192)throw Error('Viewer metrics too large');}
    const v=JSON.parse(body);if(typeof v.id!=='string'||v.id.length>64)throw Error('Invalid viewer');
    if(!viewers.has(v.id)&&viewers.size>=8)viewers.delete(viewers.keys().next().value);
    const entry={id:v.id,at:Date.now()};for(const key of ['received','displayed','replaced','frozen','lastFrame','rate','p95'])if(typeof v[key]==='number'||typeof v[key]==='boolean')entry[key]=v[key];
    viewers.set(v.id,entry);return json({ok:true});
   }
   if(req.method==='POST'&&url.pathname==='/api/control'){
    expire();if(req.headers['x-rea-token']!==token)return json({error:'Missing control token'},403);
    if(!(req.headers['content-type']??'').startsWith('application/json'))return json({error:'Expected JSON'},415);
    let body='';for await(const b of req){body+=b;if(body.length>65536)throw Error('Command too large');}
    const c=JSON.parse(body);if(!allowed.has(c.action))throw Error('Unknown action');
    const result=await sendCommand(c);return json(result,result.ok?200:400);
   }
   if(req.method!=='GET')return json({error:'Method not allowed'},405);
   if(noteRoute){
    const [,id,file]=noteRoute;if(!file)return json(await notes.get(id));
    if(file==='investigation.zip'){const s=await notes.snapshot(id);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="rea-note-${id}.zip"`});return res.end(await exportBundle(s,id));}
    if(['memory','pixel','image'].includes(file)){
     const s=await notes.snapshot(id);
     if(file==='image'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(png(s,p.get('view')??'atlas'));}
     if(file==='pixel')return json(inspectPixel(s,p.get('view')??'composite',Number(p.get('x')),Number(p.get('y'))));
     const start=Number(p.get('start')??0),length=Number(p.get('length')??128),space=p.get('space')??'Main Memory',{domain,bytes}=range(s.meta,s.payload,space,start,length);
     return json({snapshot:s.meta.id,frame:s.meta.frame,space:domain.name,start,length:bytes.length,hex:bytes.toString('hex'),endian:domain.endian});
    }
    const bytes=await notes.file(id,file),mime=file.endsWith('.png')?'image/png':file.endsWith('.json')?'application/json':file.endsWith('.md')?'text/markdown; charset=utf-8':'application/octet-stream';
    if(file==='capture.bin'){const s=await notes.snapshot(id);res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end(s.packet);}
    res.writeHead(200,{'Content-Type':mime,...(file.endsWith('.bin')||file.endsWith('.bk2')?{'Content-Disposition':`attachment; filename="${file}"`}:{})});return res.end(bytes);
   }
   switch(url.pathname){
    case '/api/catalog':return json(await catalogs.read(catalogGame(exactCapture(p.get('snapshot')).meta)));
    case '/api/catalog/pick':return json(pickCatalog(exactCapture(p.get('snapshot')),p.get('view'),Number(p.get('x')??NaN),Number(p.get('y')??NaN)));
    case '/api/session':return json({schema:1,product:'TURBO REAPER - BizHawk',assets:romAsset?{hucard:{sha1:romSha1,sha256:romSha256,bytes:romAsset.length,matchesMachine:latest?.meta.rom.hash===romSha1,exportedByDefault:false}}:null,token,status:sessionStatus(),capabilities:{movies:true,frameStep:true,checkpoints:true,...latest?.meta.capabilities},features:{execution:{support:'supported',stopGranularity:'completed frame',maxFrames:3600,speeds:[10,25,50,75,100,150,200,400]},evidence:{support:'supported',pinning:true,savedReview:true,exports:['capture','investigation ZIP']},checkpoints:{support:'supported',lifetime:'persistent disk',compatibility:['ROM','core','version','sync settings','native binary when recorded']},trace:{support:'unsupported',reason:'No bounded instruction-trace service is implemented by the REA PCEHawk bridge; native debugger availability depends on the core.'},watch:{support:'unsupported',reason:'No CPU breakpoint/watch service is exposed. Copied memory can be compared without hardware-port reads.'},collision:{support:'unsupported',reason:'No verified ROM-specific collision adapter is installed. SATB bounds are hardware diagnostics, not game hitboxes.'}},metrics:stats()});
    case '/api/rom':{const s=getSnapshot(p,true);if(!romAsset||s.meta.rom.hash!==romSha1)throw Error('Matching authorized raw HuCard asset unavailable; no ROM bytes substituted');const start=Number(p.get('start')??0),length=Number(p.get('length')??128);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||start>=romAsset.length||length<1||length>4096)throw Error('Invalid immutable ROM byte range');const bytes=romAsset.subarray(start,Math.min(start+length,romAsset.length));return json({snapshot:s.meta.id,domain:'ROM',sha256:romSha256,start,length:bytes.length,size:romAsset.length,endian:'Little',wordSize:1,unit:'byte',immutable:true,hex:bytes.toString('hex'),semantics:'Verified raw HuCard file; mapper address resolution is separate'});}
    case '/api/logical':return json(logicalAddress(getSnapshot(p,true),Number(p.get('address'))));
    case '/api/metrics':return json({...stats(),catalog:tracking.measure()});
    case '/api/history':return json([...history.values()].map(s=>({id:s.meta.id,frame:s.meta.frame})));
    case '/api/movies':return json((await readdir(path.join(root,'movies')).catch(()=>[])).filter(n=>n.endsWith('.bk2')));
    case '/api/checkpoints':return json(await checkpointList());
    case '/api/export':{const s=await evidence(p);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="rea-evidence-${s.meta.frame}.zip"`});return res.end(await exportBundle(s,p.get('Note')));}
    case '/api/compare':{const a=await evidence(p,'from'),b=await evidence(p,'to'),space=p.get('space')??'Main Memory',reason=comparisonReason(a.meta,b.meta,space);if(reason)throw Error(reason);const start=Number(p.get('start')??0),length=Number(p.get('length')??128),x=range(a.meta,a.payload,space,start,length).bytes,y=range(b.meta,b.payload,space,start,length).bytes;return json({from:{id:a.meta.id,frame:a.meta.frame},to:{id:b.meta.id,frame:b.meta.frame},space,start,length,beforeHex:x.toString('hex'),afterHex:y.toString('hex'),changes:[...x].flatMap((v,i)=>v===y[i]?[]:[{offset:start+i,before:v,after:y[i]}])});}
    case '/api/annotations':return json((await notes.list()).filter(n=>(!p.get('rom')||n.snapshot.rom.hash===p.get('rom'))&&(!p.get('movie')||n.movie.filename===p.get('movie'))).map(({body,domains,files,...n})=>n));
    case '/api/snapshot':{const s=getSnapshot(p,true);return json(s.meta);}
    case '/api/live':{const s=getSnapshot(p);res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end(s.packet);}
    case '/api/memory':{
     const s=getSnapshot(p,true),start=Number(p.get('start')??0),length=Number(p.get('length')??256),space=p.get('space')??'Main Memory';
     const {domain,bytes}=range(s.meta,s.payload,space,start,length);return json({snapshot:s.meta.id,frame:s.meta.frame,space:domain.name,start,length:bytes.length,hex:bytes.toString('hex'),endian:domain.endian});
    }
    case '/api/diff':{
     const s=getSnapshot(p,true),old=getSnapshot(new URLSearchParams({snapshot:p.get('from')??''}));
     const start=Number(p.get('start')??0),length=Number(p.get('length')??256),space=p.get('space')??'Main Memory';
     const reason=comparisonReason(old.meta,s.meta,space);if(reason)throw Error(reason);
     const a=range(old.meta,old.payload,space,start,length).bytes,b=range(s.meta,s.payload,space,start,length).bytes;
     return json({from:old.meta.id,to:s.meta.id,changes:[...a].flatMap((v,i)=>v===b[i]?[]:[{offset:start+i,before:v,after:b[i]}])});
    }
    case '/api/sprites':{const s=getSnapshot(p,true);return json({snapshot:s.meta.id,kind:'hardware-bounds-not-game-hitboxes',sprites:s.meta.sprites});}
    case '/api/pixel':{const s=getSnapshot(p,true);return json(inspectPixel(s,p.get('view')??'composite',Number(p.get('x')),Number(p.get('y'))));}
    case '/api/image':{const s=getSnapshot(p,true);res.writeHead(200,{'Content-Type':'image/png'});return res.end(png(s,p.get('view')??'atlas'));}
    default:{
     const file={'/':'index.html','/app.mjs':'app.mjs','/transport.mjs':'transport.mjs','/model.mjs':'model.mjs','/memory.mjs':'memory.mjs','/renderer.mjs':'renderer.mjs','/notes.mjs':'notes.mjs','/catalog-ui.mjs':'catalog-ui.mjs','/vendor/note-renderer.mjs':'vendor/note-renderer.mjs','/vendor/note-renderer.mjs.LEGAL.txt':'vendor/note-renderer.mjs.LEGAL.txt','/style.css':'style.css'}[url.pathname];
     if(!file)return json({error:'Not found'},404);
     res.writeHead(200,{'Content-Type':file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.txt')?'text/plain; charset=utf-8':'text/html'});return res.end(await readFile(path.join(root,'public',file)));
    }
   }
  }catch(e){if(!res.headersSent)json({error:e.message},e.status??400);else res.destroy();}
 });
 server.on('upgrade',(req,socket)=>{
  if(clients.size>=8||req.url!=='/stream'||!safeHost(req.headers.host)||req.headers.origin!==`http://${req.headers.host}`||req.headers['sec-websocket-version']!=='13'||!req.headers['sec-websocket-key'])return socket.destroy();
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.setNoDelay(true);socket.pendingFrames=0;clients.add(socket);if(lastStream)socket.write(websocketFrame(lastStream));
  socket.on('data',()=>{});socket.on('error',()=>{});socket.on('close',()=>clients.delete(socket));
 });
 await new Promise((resolve,reject)=>{ingest.once('error',reject);ingest.listen(streamPort,'127.0.0.1',resolve);});
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(e){ingest.close();throw e;}
 return {server,ingest,publish,stats,close:async()=>{for(const c of clients)c.destroy();for(const s of producerSockets)s.destroy();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>ingest.close(r))]);},port:server.address().port,streamPort:ingest.address().port};
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url)){
 const app=await start({port:Number(process.env.REA_TG16_HTTP_PORT??8920),streamPort:Number(process.env.REA_TG16_STREAM_PORT??8921)});
 console.log(JSON.stringify({url:`http://127.0.0.1:${app.port}`,streamPort:app.streamPort}));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit();});
}
