import assert from 'node:assert/strict';import {writeFile,readFile} from 'node:fs/promises';import {unpack,range,inspectPixel} from '../protocol.mjs';
const base=process.env.REA_URL??'http://127.0.0.1:8920';const token=(await(await fetch(base+'/api/session')).json()).token;
const initial=(await(await fetch(base+'/api/session')).json()).status.live;
assert.equal(initial?.rom.hash,'8D336E18A6D9CC2DDF69F9FB8819FF9E0502E01A','Native regression requires the original diagnostic, not a user game');
async function command(c){const r=await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':token},body:JSON.stringify(c)});const v=await r.json();assert(r.ok,JSON.stringify(v));return v.result;}
async function capture(){const m=await(await fetch(base+'/api/snapshot')).json();return unpack(Buffer.from(await(await fetch(base+'/api/live?snapshot='+m.id)).arrayBuffer()));}
const name='native-'+Date.now();await command({action:'pause'});await command({action:'step',frames:10});await command({action:'checkpoint-save',name});
const before=await capture();assert(before.meta.raster.valid);assert.equal(range(before.meta,before.payload,'Main Memory',0,9).bytes.toString(),'TURBO-REA');
const p=(view,x,y)=>inspectPixel(before,view,x,y);assert.deepEqual(p('bg1',0,30).rgb,[255,0,0]);assert.deepEqual(p('bg1',0,100).rgb,[0,255,0]);
assert.equal(p('obj',64,48).nativeSamples.spriteIndex,0);assert.equal(p('obj',96,48).nativeSamples.spriteIndex,1);
assert.equal(p('bg1',1,100).alpha,0);assert.deepEqual(p('composite',64,48).rgb,[255,255,255]);assert.deepEqual(p('composite',96,48).rgb,[255,0,0]);
// Rendering enabled/disabled must produce identical entire core state and output.
const results=[];
for(const enabled of [true,false,true]){
 await command({action:'checkpoint-load',name});const invalid=await capture();assert.equal(invalid.meta.raster.valid,false);
 await command({action:'raster-enable',enabled});await command({action:'step',frames:30,buttons:{'P1 B1':true,'P1 Right':true}});
 const hash=(await command({action:'state-hash'})).sha256,s=await capture();const img=Buffer.from(await(await fetch(base+'/api/image?snapshot='+s.meta.id+'&view=composite')).arrayBuffer());
 const ram=range(s.meta,s.payload,'Main Memory',0,32).bytes;
 results.push({enabled,hash,ram:ram.toString('hex'),image:img.toString('base64'),frame:s.meta.frame,valid:s.meta.raster.valid});
}
assert.equal(results[0].hash,results[1].hash);assert.equal(results[0].hash,results[2].hash);assert.equal(results[0].image,results[1].image);assert.equal(results[0].ram,results[2].ram);
// Digital I + Right is recorded by the emulated controller protocol, not host keys.
assert.notEqual(results[0].ram.slice(34,38),before.payload.subarray(17,19).toString('hex'));
const movie='movie-'+Date.now();await command({action:'record',name:movie,start:'checkpoint'});await command({action:'step',frames:20,buttons:{'P1 B2':true}});await command({action:'movie-save'});await command({action:'movie-stop'});
const playback=[];for(let i=0;i<2;i++){
 await command({action:'play',name:movie});await command({action:'step',frames:15});
 const h=(await command({action:'state-hash'})).sha256;const inputs=await command({action:'movie-inputs',start:0,length:10});assert.equal(inputs.length,10);playback.push(h);
 const r=await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':token},body:JSON.stringify({action:'step',frames:1,buttons:{'P1 B1':true}})});assert.equal(r.status,400);await command({action:'movie-stop'});
}assert.equal(playback[0],playback[1]);
// Bounded steps can be interrupted at a completed-frame boundary.
const pending=fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':token},body:JSON.stringify({action:'step',frames:3600,buttons:{}})});
for(let i=0;i<50;i++){const status=await(await fetch(base+'/api/session')).json();if(status.metrics.pending.includes('step'))break;await new Promise(r=>setTimeout(r,10));}
await command({action:'pause'});const interrupted=await(await pending).json();assert.equal(interrupted.ok,false);assert(interrupted.result.completedFrames<3600);
// Own generated checkpoint: incompatible build metadata must reject before loading.
const sidecar=new URL('../checkpoints/'+name+'.State.json',import.meta.url),original=await readFile(sidecar,'utf8');
try{await writeFile(sidecar,JSON.stringify({...JSON.parse(original),native:'wrong-build'}));const r=await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':token},body:JSON.stringify({action:'checkpoint-load',name})});assert.equal(r.status,400);}finally{await writeFile(sidecar,original);}
const final=await capture();await writeFile(new URL('../test-output/diagnostic-capture.bin',import.meta.url),final.packet);
const report={ok:true,interrupted:interrupted.result,checkpoint:name,movie,integrity:results.map(({image,...r})=>r),playback,diagnostic:{ramSignature:true,rasterPalette:true,admittedSprites:true,priority:true,transparency:true},at:new Date().toISOString()};
await writeFile(new URL('../test-output/native-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
