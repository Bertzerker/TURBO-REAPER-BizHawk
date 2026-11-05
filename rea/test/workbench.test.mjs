// SPDX-License-Identifier: MIT
import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {fixture} from './fixture.mjs';import {unpack,Framer,range,logicalAddress,inspectPixel} from '../protocol.mjs';import {start} from '../server.mjs';import {Annotations} from '../annotations.mjs';import {png} from '../server.mjs';import {SelectionRequest,comparisonReason,checkpointReason,memoryRange} from '../public/model.mjs';import {WordRuns,decodeStream} from '../public/transport.mjs';import {streamPacket} from '../server.mjs';
const post=(base,token,route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':token},body:JSON.stringify(body)});
test('Fragmentation, malformed blocks and lossless atlas transport',()=>{
 const s=fixture(),prefix=Buffer.alloc(4);prefix.writeUInt32LE(s.packet.length);let observed;const framer=new Framer(p=>observed=p);const wire=Buffer.concat([prefix,s.packet]);for(let i=0;i<wire.length;i+=13)framer.push(wire.subarray(i,i+13));assert.deepEqual(observed.packet,s.packet);
 assert.throws(()=>new Framer(()=>{}).push(Buffer.from([255,255,255,255])));assert.throws(()=>unpack(Buffer.from([255,255,255,255])));
 const stream=decodeStream(streamPacket(s,new WordRuns()));assert.deepEqual(Buffer.from(stream.bytes),s.payload.subarray(0,s.meta.raster.offset));
 const bad={...s.meta,atlas:{...s.meta.atlas,panels:[{x:-1,y:0,width:4,height:4}]}};const j=Buffer.from(JSON.stringify(bad)),p=Buffer.alloc(4);p.writeUInt32LE(j.length);assert.throws(()=>unpack(Buffer.concat([p,j,s.payload])),/bounds/);
});
test('Memory units, clipped domain edges and logical/physical context',()=>{
 const s=fixture();assert.equal(range(s.meta,s.payload,'VRAM1',65535,128).bytes.length,1);assert.throws(()=>range(s.meta,s.payload,'VRAM1',65536,1));
 assert.equal(memoryRange(s.meta,'Main Memory',8191,128).length,1);assert.equal(logicalAddress(s,0x2000).physicalAddress,0x1f0000);assert.equal(logicalAddress(s,0x2000).byte,84);assert.equal(logicalAddress(s,0).available,false);
 assert.equal(inspectPixel(s,'composite',0,0).nativeSamples.spriteIndex,null);assert.throws(()=>inspectPixel(s,'composite',4,0));
 assert.match(comparisonReason(s.meta,{...s.meta,identity:{native:'other'}},'VRAM1'),/configuration/);assert.match(checkpointReason({rom:'other'},s.meta),/ROM/);
});
test('Obsolete asynchronous selection results are rejected',async()=>{
 const model=new SelectionRequest(),context={meta:{id:'a'}},resolvers=[];const lookup=(c,p)=>new Promise(r=>resolvers.push(()=>r({snapshot:c.meta.id,...p})));
 const a=model.select(context,{view:'obj',x:1,y:2},async()=>{},lookup);await Promise.resolve();const b=model.select(context,{view:'bg1',x:3,y:2},async()=>{},lookup);await Promise.resolve();resolvers[1]();assert.equal((await b).point.view,'bg1');resolvers[0]();assert.equal(await a,null);
});
test('Authenticated producer, bounded history, expiring leases and host/origin/token rejection',async()=>{
 const app=await start({port:0,streamPort:0,nativeToken:'fixture-secret',leaseMs:100}),base=`http://127.0.0.1:${app.port}`;let sock;
 try{
  const {token,status}=await(await fetch(base+'/api/session')).json();assert.equal(status.producerConnected,false);
  assert.equal((await fetch(base+'/api/session',{headers:{Origin:'http://foreign.example'}})).status,403);
  assert.equal((await post(base,'wrong','/api/control',{action:'pause'})).status,403);
  sock=net.connect(app.streamPort,'127.0.0.1');await new Promise(r=>sock.once('connect',r));assert.equal((await(await fetch(base+'/api/session')).json()).status.producerConnected,false);
  const send=p=>{const prefix=Buffer.alloc(4);prefix.writeUInt32LE(p.length);sock.write(Buffer.concat([prefix,p]));};const h=Buffer.from(JSON.stringify({type:'hello',token:'fixture-secret'})),hp=Buffer.alloc(4);hp.writeUInt32LE(h.length);send(Buffer.concat([hp,h]));send(fixture().packet);
  for(let i=0;i<50;i++){if((await(await fetch(base+'/api/session')).json()).status.live)break;await new Promise(r=>setTimeout(r,10));}
  const owner='12345678-1234-1234-1234-123456789abc';assert.equal((await post(base,token,'/api/pin',{owner,slot:'evidence',generation:2,snapshot:fixture().meta.id})).status,200);
  assert.equal((await post(base,token,'/api/pin',{owner,slot:'evidence',generation:1,snapshot:fixture().meta.id})).status,409);
  for(let i=2;i<32;i++)app.publish(fixture(i));assert.equal((await fetch(base+'/api/live?snapshot='+fixture().meta.id)).status,200);
  await new Promise(r=>setTimeout(r,120));assert.equal((await fetch(base+'/api/live?snapshot='+fixture().meta.id)).status,404);
  sock.destroy();
 }finally{sock?.destroy();await app.close();}
});
test('Concurrent note revisions retain history, saved review and offline bundle survive restart',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'turbo-rea-test-'));let app=await start({port:0,streamPort:0,root}),base=`http://127.0.0.1:${app.port}`;
 try{
  const s=fixture();app.publish(s);const {token}=await(await fetch(base+'/api/session')).json();const res=await post(base,token,'/api/annotations/capture',{snapshot:s.meta.id});assert.equal(res.status,201);const note=await res.json();
  const body={revision:1,title:'Raster observation',format:'json',body:'{"raster":true}',category:'observation'};
  const updates=await Promise.all([post(base,token,'/api/annotations/'+note.id,body),post(base,token,'/api/annotations/'+note.id,{...body,title:'stale'})]);assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
  const store=new Annotations(root,png),saved=await store.get(note.id);assert.equal(saved.revisions.length,1);assert.equal(saved.revisions[0].revision,1);
  await assert.rejects(store.update(note.id,{revision:2,format:'json',body:'{bad'}));
  await app.close();app=await start({port:0,streamPort:0,root});base=`http://127.0.0.1:${app.port}`;
  assert.equal((await(await fetch(base+`/api/annotations/${note.id}/memory?space=Main%20Memory&start=0&length=9`)).json()).hex,Buffer.from('TURBO-REA').toString('hex'));
  const bundle=path.join(root,'evidence.zip');await writeFile(bundle,Buffer.from(await(await fetch(base+`/api/annotations/${note.id}/investigation.zip`)).arrayBuffer()));const check=spawnSync('C:/Users/Chris/AppData/Local/Python/bin/python.exe',[fileURLToPath(new URL('../verify_bundle.py',import.meta.url)),bundle],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
  assert.equal((await fetch(base+'/api/annotations/../../anything')).status,404);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
