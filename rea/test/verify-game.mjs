// SPDX-License-Identifier: MIT
// Local user-asset validation only. All resulting evidence stays ignored.
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {unpack} from '../protocol.mjs';
const base=process.env.REA_URL??'http://127.0.0.1:8920';let session;
for(let i=0;i<100;i++){session=await(await fetch(base+'/api/session')).json();if(session.status.live)break;await new Promise(r=>setTimeout(r,100));}
assert.match(session.status.live.rom.name,/R-Type/i,'This test requires the explicitly supplied local game');
const cmd=async body=>{const r=await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':session.token},body:JSON.stringify(body)});const j=await r.json();assert(r.ok,JSON.stringify(j));return j.result;};
const capture=async()=>{const m=await(await fetch(base+'/api/snapshot')).json();return unpack(Buffer.from(await(await fetch(base+'/api/live?snapshot='+m.id)).arrayBuffer()));};
await cmd({action:'pause'});await cmd({action:'step',frames:180});const name='local-game-'+Date.now();await cmd({action:'checkpoint-save',name});
const sequence=async()=>{await cmd({action:'step',frames:30,buttons:{'P1 Run':true}});await cmd({action:'step',frames:120,buttons:{'P1 B1':true,'P1 Right':true}});};
const results=[];for(let run=0;run<2;run++){
 await cmd({action:'checkpoint-load',name});assert.equal((await capture()).meta.raster.valid,false);await sequence();const state=(await cmd({action:'state-hash'})).sha256,s=await capture();assert(s.meta.raster.valid);
 const image=Buffer.from(await(await fetch(base+'/api/image?snapshot='+s.meta.id+'&view=composite')).arrayBuffer());
 const output=createHash('sha256').update(image).digest('hex');results.push({state,output,frame:s.meta.frame,width:s.meta.geometry.width,height:s.meta.geometry.height});
 if(run===1)await writeFile(new URL('../test-output/local-game-composite.png',import.meta.url),image);
 const panels=s.meta.atlas.panels,source=panels.find(p=>p.view==='source'),bg=panels.find(p=>p.view==='bg1'),obj=panels.find(p=>p.view==='obj'),out=panels.find(p=>p.view==='composite');
 const word=(p,x,y)=>s.payload.readUInt32LE(s.meta.atlas.offset+((p.y+y)*s.meta.atlas.width+p.x+x)*4)>>>0;
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){const cls=word(source,x,y),expected=cls===0xff92d6b2?bg:cls===0xffe4be7c?obj:null;if(expected)assert.equal(word(out,x,y),word(expected,x,y));}
}
assert.deepEqual(results[0],results[1]);
const movie='local-game-movie-'+Date.now();await cmd({action:'record',name:movie,start:'checkpoint'});await cmd({action:'step',frames:90,buttons:{'P1 B1':true,'P1 Right':true}});await cmd({action:'movie-stop'});
const playback=[];for(let run=0;run<2;run++){await cmd({action:'play',name:movie});const hashes=[];for(let part=0;part<3;part++){await cmd({action:'step',frames:30});hashes.push((await cmd({action:'state-hash'})).sha256);}playback.push(hashes);await cmd({action:'movie-stop'});}assert.deepEqual(playback[0],playback[1]);
const report={ok:true,scope:'Explicitly supplied local HuCard; no assets or evidence may be committed',checkpoint:name,movie,results,playback,compositionChecked:true};await writeFile(new URL('../test-output/local-game-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,scope:'local supplied HuCard',dimensions:results[0].width+'x'+results[0].height,checkpointReplay:true,movieReplay:true,compositionChecked:true}));
