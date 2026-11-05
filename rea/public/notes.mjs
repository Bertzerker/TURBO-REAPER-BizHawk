// SPDX-License-Identifier: MIT
export function setupNotes({api,getCurrent,getContext,pinDisplayed,inspectSaved,openDrawer,onSaved}){
 const $=id=>document.getElementById(id);let selected,dirty=false,busy=false,renderer,serial=0,listSerial=0,lastRom,orphan=null,baseReasons={};
 const feedback=s=>$('note-feedback').textContent=s;
 const draft=()=>orphan??({id:selected?.id,revision:selected?.revision,title:$('note-title').value,format:$('note-format').value,category:$('note-category').value,body:$('note-body').value});
 const storeDraft=d=>localStorage.setItem('rea-tg16-comment-draft',JSON.stringify(d));
 function availability(){for(const [id,reason]of [['capture-comment',baseReasons.displayedReason],['pause-capture-comment',baseReasons.currentReason]]){const b=$(id),why=busy?'Saving frame evidence':dirty?'Save or discard the current draft before capturing another comment':reason;b.disabled=!!why;b.title=why??'';b.setAttribute('aria-label',why?b.textContent+' — '+why:b.textContent);} $('discard-draft').disabled=!dirty;$('recover-draft').disabled=!localStorage.getItem('rea-tg16-comment-discarded');}
 function remember(){if(!selected)return;dirty=true;storeDraft(draft());feedback('Unsaved browser draft · Save, export or discard to continue.');availability();}
 async function preview(){const ticket=++serial;try{renderer??=import('/vendor/note-renderer.mjs');const {renderNote}=await renderer;if(ticket!==serial)return;await renderNote($('note-preview'),$('note-format').value,$('note-body').value);}catch(e){$('note-preview').textContent='Preview error: '+e.message;}}
 async function list(){const current=getCurrent(),query=$('all-notes').checked?'':current?'?rom='+encodeURIComponent(current.meta.rom.hash):'',ticket=++listSerial,rows=await api('/api/annotations'+query);if(ticket!==listSerial)return;$('note-list').replaceChildren();if(!rows.length)$('note-list').textContent='No saved comments for this game.';for(const n of rows){const b=document.createElement('button'),title=document.createElement('b'),detail=document.createElement('small');b.className='note-row';title.textContent=n.title;detail.textContent=`Frame ${n.movie.timelineFrame??n.snapshot.frame} · ${n.category??'observation'} · ${n.format} · ${n.movie.filename||'No movie'}`;b.append(title,detail);b.onclick=()=>guard(()=>open(n.id));$('note-list').append(b);}}
 async function open(id,recovered=null){
  if(dirty&&!recovered)throw Error('Save, export or discard the current draft before switching notes.');
  const note=await api('/api/annotations/'+id);selected=note;orphan=null;dirty=false;$('note-empty').hidden=true;$('note-editor').hidden=false;$('note-conflict').hidden=true;
  $('note-title').value=note.title;$('note-format').value=note.format;$('note-category').value=note.category??'observation';$('note-body').value=note.body;
  $('note-frame').textContent=`Saved render · frame ${note.snapshot.frame} · PPU capture ${note.snapshot.generation}`;$('note-movie').textContent=note.movie.loaded?`${note.movie.filename} · movie frame ${note.movie.timelineFrame??'after end'}${note.movie.previousInputRow!==null?' · after input row '+note.movie.previousInputRow:''}${note.movie.archived?' · BK2 version archived':''}`:'No movie at capture';$('note-rom').textContent=note.snapshot.rom.name+' · '+note.snapshot.rom.hash;$('note-thumbnail').src=`/api/annotations/${id}/composite.png`;
  const tracking=note.tracking,isolation=!!note.files['catalog-isolation.png'];
  $('note-catalog').hidden=!tracking;
  $('note-catalog-image').hidden=!isolation;
  if(isolation)$('note-catalog-image').src=`/api/annotations/${id}/catalog-isolation.png`;
  else $('note-catalog-image').removeAttribute('src');
  if(tracking){
   $('note-catalog-summary').textContent=`${tracking.entry.name} · entry revision ${tracking.entry.revision} · ${tracking.state} · ${tracking.evidenceClass} · frame ${tracking.capture.frame}`;
   $('note-catalog-detail').textContent=JSON.stringify(tracking,null,2);
  }
  const trackingFiles=tracking?[['catalog-observation.json','Catalog observation'],...(isolation?[['catalog-isolation.png','Saved isolation']]:[])]:[];
  $('note-downloads').replaceChildren();for(const [file,label]of [['atlas.png','Graphics atlas'],['memory.bin','Memory'],['capture.bin','Native capture'],['annotation.json','JSON'],['comment.md','Markdown'],['investigation.zip','Investigation ZIP'],...(note.movie.archived?[['movie.bk2','BK2 version']]:[]),...trackingFiles]){const a=document.createElement('a');a.href=`/api/annotations/${id}/${file}`;a.download=file;a.textContent=label;$('note-downloads').append(a);}
  if(recovered){$('note-title').value=recovered.title;$('note-format').value=recovered.format;$('note-category').value=recovered.category??'observation';$('note-body').value=recovered.body;selected.revision=recovered.revision;dirty=true;feedback('Recovered unsaved draft. Save, export or intentionally discard it.');}else feedback('Saved revision '+note.revision+'.');availability();await preview();
 }
 async function capture(mode,tracking=null,category='observation'){
  if(busy)throw Error('A frame comment is already being captured');
  if(dirty)throw Error('Save or discard your draft first. Export can keep a separate copy.');
  busy=true;
  availability();
  try{
   let body=tracking?{tracking,category}:{};
   if(mode==='displayed'){
    await pinDisplayed();
    const c=getContext();
    if(!c)throw Error('No displayed evidence');
    body=c.saved?{annotation:c.saved}:{snapshot:c.meta.id};
   }
   const status=mode==='current'?'Pausing and capturing current frame…':tracking?'Saving pinned catalog observation…':'Saving displayed evidence…';
   if(!tracking)openDrawer();
   $('note-status').textContent=status;
   const note=await api('/api/annotations/capture',{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':(await api('/api/session')).token},body:JSON.stringify(body)});
   if(tracking)openDrawer();
   $('note-status').textContent='Saved frame '+note.snapshot.frame;
   await list();await open(note.id);await inspectSaved(note);await onSaved?.();$('note-body').focus();
  }finally{busy=false;availability();}
 }
 async function save(){if(!selected||orphan)throw Error('Original note is unavailable; export or discard the draft.');try{const note=await api('/api/annotations/'+selected.id,{method:'POST',headers:{'Content-Type':'application/json','X-REA-Token':(await api('/api/session')).token},body:JSON.stringify(draft())});selected=note;dirty=false;localStorage.removeItem('rea-tg16-comment-draft');$('note-conflict').hidden=true;feedback('Saved revision '+note.revision+' to disk.');availability();await preview();await list();await onSaved?.();}catch(e){if(e.status===409){const latest=await api('/api/annotations/'+selected.id);$('conflict-server').value=JSON.stringify({title:latest.title,format:latest.format,category:latest.category,revision:latest.revision,body:latest.body},null,2);$('note-conflict').hidden=false;$('conflict-load').onclick=()=>guard(async()=>{localStorage.setItem('rea-tg16-comment-discarded',JSON.stringify(draft()));dirty=false;localStorage.removeItem('rea-tg16-comment-draft');await open(latest.id);feedback('Server version loaded. Your previous draft can be recovered.');});$('conflict-rebase').onclick=()=>{selected.revision=latest.revision;storeDraft(draft());$('note-conflict').hidden=true;feedback('Your draft is preserved against server revision '+latest.revision+'. Review and Save to replace that version.');};feedback('Edit conflict: your draft is intact. Compare the server version below or export your draft.');}else throw e;}}
 function exportDraft(){const blob=new Blob([JSON.stringify(draft(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='rea-comment-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);feedback('Draft exported; it remains unsaved until saved or discarded.');}
 async function discard(){if(!dirty)return;const old=draft();localStorage.setItem('rea-tg16-comment-discarded',JSON.stringify(old));localStorage.removeItem('rea-tg16-comment-draft');dirty=false;orphan=null;if(selected)await open(selected.id);else{$('note-editor').hidden=true;$('note-empty').hidden=false;}feedback('Draft intentionally discarded. Recover discarded draft can restore it.');availability();}
 async function recover(){if(dirty)throw Error('Save or discard the current draft before recovering another.');const cached=localStorage.getItem('rea-tg16-comment-discarded');if(!cached)throw Error('No discarded draft');const d=JSON.parse(cached);storeDraft(d);await open(d.id,d);}
 async function guard(fn){try{await fn();}catch(e){feedback(e.message);$('note-status').textContent=e.message;}}
 $('capture-comment').onclick=()=>guard(()=>capture('displayed'));$('pause-capture-comment').onclick=()=>guard(()=>capture('current'));$('refresh-notes').onclick=()=>guard(list);$('all-notes').onchange=()=>guard(list);$('preview-note').onclick=()=>guard(preview);$('save-note').onclick=()=>guard(save);$('inspect-note').onclick=()=>guard(()=>inspectSaved(selected));
 $('discard-draft').onclick=()=>guard(discard);$('recover-draft').onclick=()=>guard(recover);$('export-draft').onclick=exportDraft;
 for(const id of ['note-title','note-body','note-format','note-category'])$(id).addEventListener('input',remember);
 function insert(language,source){$('note-format').value='markdown';const el=$('note-body');el.setRangeText('\n```'+language+'\n'+source+'\n```\n',el.selectionStart,el.selectionEnd,'end');el.focus();remember();}
 $('insert-json').onclick=()=>insert('json','{\n  "observation": "",\n  "address": "0x0010"\n}');$('insert-mermaid').onclick=()=>insert('mermaid','flowchart LR\n Input --> GameState\n GameState --> Render');
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 guard(async()=>{await list();const cached=localStorage.getItem('rea-tg16-comment-draft');if(cached){const d=JSON.parse(cached);try{await open(d.id,d);openDrawer();}catch{orphan=d;dirty=true;feedback('Recovered draft has no accessible original note. Export or discard it to continue.');openDrawer();}}availability();});
 return {captureTracked:(tracking,category)=>capture('tracked',tracking,category),onFrame(){const hash=getCurrent()?.meta.rom.hash;if(hash!==lastRom){lastRom=hash;guard(list);}},setAvailability(reasons){baseReasons=reasons;availability();}};
}
