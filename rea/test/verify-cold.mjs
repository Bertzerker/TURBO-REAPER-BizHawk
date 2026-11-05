// SPDX-License-Identifier: MIT
// Run after a real process restart following verify-native.mjs.
import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';
const base=process.env.REA_URL??'http://127.0.0.1:8920',previous=JSON.parse(await readFile(new URL('../test-output/native-report.json',import.meta.url),'utf8'));
let session;for(let i=0;i<100;i++){session=await(await fetch(base+'/api/session')).json();if(session.status.live)break;await new Promise(r=>setTimeout(r,100));}
const command=async body=>{const r=await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':session.token},body:JSON.stringify(body)});const j=await r.json();assert(r.ok,JSON.stringify(j));return j.result;};
await command({action:'play',name:previous.movie});await command({action:'step',frames:15});const result=await command({action:'state-hash'});assert.equal(result.sha256,previous.playback[0]);await command({action:'movie-stop'});
const notes=await(await fetch(base+'/api/annotations')).json();for(const note of notes){const r=await fetch(base+`/api/annotations/${note.id}/pixel?view=composite&x=64&y=48`);assert.equal(r.status,200);assert.equal((await r.json()).snapshot,note.snapshot.id);}
const rom=await(await fetch(base+'/api/rom?start=0&length=4')).json();assert.equal(rom.domain,'ROM');assert(rom.sha256);
const logical=await(await fetch(base+'/api/logical?address=8192')).json();assert.equal(logical.physicalAddress,0x1f0000);assert.equal(logical.byte,84);
const report={ok:true,coldReplayState:result.sha256,movie:previous.movie,savedEvidenceCount:notes.length,immutableRomSha256:rom.sha256,logical};await writeFile(new URL('../test-output/cold-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
