import {writeFile} from 'node:fs/promises';import {performance} from 'node:perf_hooks';
const base=process.env.REA_URL??'http://127.0.0.1:8920',token=(await(await fetch(base+'/api/session')).json()).token;
const cmd=async c=>{const r=await fetch(base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':token},body:JSON.stringify(c)});if(!r.ok)throw Error(await r.text());return r.json();};
const rows=[];await cmd({action:'resume'});const start=performance.now();
while(performance.now()-start<180000){const s=await(await fetch(base+'/api/session')).json();rows.push({at:performance.now()-start,frame:s.status.live.frame,copy:s.status.live.capture_ms,encode:s.status.live.encode_ms,skipped:s.status.live.skipped,valid:s.status.live.raster.valid,metrics:s.metrics});await new Promise(r=>setTimeout(r,1000));}
await cmd({action:'pause'});const first=rows[0],last=rows.at(-1),pct=(k,p)=>rows.map(x=>x[k]).sort((a,b)=>a-b)[Math.floor(rows.length*p)];
const report={workloadMs:performance.now()-start,durationMs:last.at-first.at,machineFps:(last.frame-first.frame)/((last.at-first.at)/1000),copyP95:pct('copy',.95),encodeP95:pct('encode',.95),skipped:last.skipped-first.skipped,invalid:rows.filter(r=>!r.valid).length,first,last,rows};
await writeFile(new URL('../test-output/performance-180s.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined}));
