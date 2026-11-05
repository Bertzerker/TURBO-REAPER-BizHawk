// SPDX-License-Identifier: MIT
import {memoryRange,comparisonReason} from './model.mjs';
export function setupMemory({api,context,url,pin,report}){
 const $=id=>document.getElementById(id);let baseline=null,baselineGeneration=0,reading=false,lastKey='',request=0;
 function render(meta){
  const select=$('domain'),names=meta.domains.map(d=>d.name).join('|');if(select.dataset.domains!==names){const old=select.value;select.replaceChildren(...meta.domains.map(d=>new Option(d.name,d.name)));select.value=meta.domains.some(d=>d.name===old)?old:'Main Memory';select.dataset.domains=names;}
  const d=meta.domains.find(d=>d.name===select.value);if(d)$('memory-domain').textContent=`${d.name} · ${d.size.toLocaleString()} bytes · byte offsets · ${d.endian} endian · word size ${d.wordSize} bytes${d.name==='Main Memory'?' · physical $1F0000, mirrored 8 KiB; logical addresses require MPR context':''}`;
 }
 const fields=()=>[$('domain').value,$('address').value,$('memory-length').value].join(':');
 async function read(force=false){
  const c=context();if(!c||reading)return;const startFields=fields(),version=c.version,key=[c.saved,c.meta.id,startFields,baseline?.meta.id].join(':');if(key===lastKey&&!force)return;
  let r;try{r=memoryRange(c.meta,$('domain').value,Number($('address').value),Number($('memory-length').value));}catch(e){$('memory').textContent=e.message;return;}
  reading=true;const serial=++request;
  try{
   const params={space:r.domain.name,start:r.start,length:r.length};let result,before,after,changed=new Map();
   const reason=baseline?comparisonReason(baseline.meta,c.meta,r.domain.name):'';
   if(baseline&&!reason){const q=new URLSearchParams(params);q.set(baseline.saved?'fromNote':'from',baseline.saved??baseline.meta.id);q.set(c.saved?'toNote':'to',c.saved??c.meta.id);result=await api('/api/compare?'+q);before=result.beforeHex.match(/../g);after=result.afterHex.match(/../g);changed=new Map(result.changes.map(v=>[v.offset,v]));}
   else {result=await api(url('memory',params,c));after=result.hex.match(/../g);}
   const active=context();if(serial!==request||!active||active.version!==version||fields()!==startFields||active.saved!==c.saved||active.kind!=='live'&&active.meta.id!==c.meta.id)return;
   $('memory').replaceChildren();for(let i=0;i<after.length;i+=16){$('memory').append((r.start+i).toString(16).padStart(6,'0')+'  ');const row=after.slice(i,i+16);for(let j=0;j<row.length;j++){const cell=document.createElement('span'),change=changed.get(r.start+i+j);cell.textContent=row[j]+' ';if(change){cell.className='changed-byte';cell.title=`0x${change.offset.toString(16)}: ${change.before.toString(16).padStart(2,'0')} → ${row[j]}`;}$('memory').append(cell);}$('memory').append(' '+row.map(v=>{const n=parseInt(v,16);return n>=32&&n<127?String.fromCharCode(n):'.';}).join('')+'\n');}
   const id=result.to?.id??result.snapshot,frame=result.to?.frame??result.frame;$('memory-frame').textContent=`${r.domain.name} · frame ${frame} · ${id} · ${r.length} bytes${r.length<Number($('memory-length').value)?' (clipped at domain end)':''}`;
   $('memory-diff-status').textContent=reason||(!baseline?'No baseline selected':`${changed.size} changed / ${r.length-changed.size} unchanged bytes · baseline ${result.from.id} (frame ${result.from.frame}) → current ${id} (frame ${frame})`);lastKey=key;
  }catch(e){$('memory').textContent=e.message;}finally{reading=false;}
 }
 async function setBaseline(c){if(!c)throw Error('No displayed evidence');const generation=++baselineGeneration;if(!c.saved)await pin(c,'baseline',generation);if(generation!==baselineGeneration)return;request++;baseline={...c};$('baseline-status').textContent=`Baseline: ${c.meta.id} · frame ${c.meta.frame} · ${c.saved?'saved evidence':'held live capture'}`;lastKey='';await read(true);}
 $('set-baseline').onclick=()=>report(()=>setBaseline(context()));$('clear-baseline').onclick=()=>report(async()=>{baseline=null;request++;$('baseline-status').textContent='No comparison baseline';lastKey='';try{await pin(null,'baseline',++baselineGeneration);}finally{await read(true);}});
 $('use-saved-baseline').onclick=()=>report(async()=>{const id=$('baseline-note').value;if(!id)throw Error('Choose saved baseline evidence');const meta=await api(`/api/annotations/${id}/snapshot.json`);await setBaseline({meta,saved:id,kind:'saved'});});
 $('memory-read').onclick=()=>{lastKey='';read(true);};
 $('domain').onchange=()=>{request++;const c=context(),d=c?.meta.domains.find(d=>d.name===$('domain').value);if(d)$('address').value='0x'+Math.min(Math.max(0,Number($('address').value)||0),d.size-1).toString(16);lastKey='';if(c)render(c.meta);read(true);};
 for(const id of ['address','memory-length'])$(id).onchange=()=>{request++;lastKey='';read(true);};
 for(const [id,direction]of [['memory-prev',-1],['memory-next',1]])$(id).onclick=()=>{const c=context();if(!c)return;const d=c.meta.domains.find(d=>d.name===$('domain').value);$('address').value='0x'+Math.min(d.size-1,Math.max(0,Number($('address').value)+direction*Number($('memory-length').value))).toString(16);lastKey='';read(true);};
 setInterval(()=>{if(baseline&&!baseline.saved)report(()=>pin(baseline,'baseline',baselineGeneration));},30000);
 return {render,read,changed(){request++;lastKey='';$('memory').textContent='Loading evidence memory…';$('memory-frame').textContent='Waiting for selected capture';read(true);},async refreshSaved(){const list=await api('/api/annotations');$('baseline-note').replaceChildren(new Option('Choose saved evidence',''),...list.map(n=>new Option(`${n.title} · frame ${n.snapshot.frame}`,n.id)));}};
}
