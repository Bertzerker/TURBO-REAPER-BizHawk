// SPDX-License-Identifier: MIT
export function setupCatalog({api,post,owner,context,liveContext,returnLive,attachComment}){
 const $=id=>document.getElementById('catalog-'+id);
 const panel=document.querySelector('[data-drawer-panel="catalog"]');
 let catalog=null,seed=null,entry=null,result=null,active=false,pinned=false,busy=false,imageUrl=null;
 let selectedPoint=null,seedRequest=0,frameScope=null;
 const say=value=>{$('status').textContent=value;};
 const endpoint='/api/catalog',observe=body=>post(endpoint+'/observe',{owner,...body});
 const displayScope=()=>context()?.meta.rom?.mappedSha256;
 const liveScope=()=>liveContext()?.rom?.mappedSha256;
 const captureId=()=>context()?.meta.id;

 function controls(){
  const compatible=!!catalog&&!context()?.saved&&catalog.game.digest.value===displayScope()?.toLowerCase();
  const usableSeed=compatible&&seed&&seed.snapshot===selectedPoint?.snapshot;
  $('add').disabled=busy||!usableSeed;
  $('append').disabled=busy||!usableSeed||entry?.kind!==seed.kind;
  $('edit').disabled=busy||!entry||!compatible;
  $('all').disabled=busy||!entry||!compatible;
  $('follow').disabled=busy||!compatible||entry?.id!==result?.entryId||!result?.candidates.length||result.evidenceClass==='boundary-bat-diagnostic'||!$('instance').value;
  $('pin').disabled=busy||!result||pinned;
  $('attach').disabled=busy||!result;
  $('bug').disabled=busy||!result;
  $('export').disabled=!catalog;
 }
 async function run(work){
  if(busy)return;
  busy=true;
  controls();
  try{await work();}
  catch(e){active=false;say(e.message);}
  finally{busy=false;controls();}
 }
 function fill(){
  $('name').value=entry?.name??'';
  $('labels').value=entry?.labels.join(', ')??'';
  $('notes').value=entry?.notes??'';
  $('selectors').value=entry?JSON.stringify(entry.selectors,null,2):'';
 }
 function list(){
  const term=$('search').value.trim().toLowerCase(),kind=$('filter').value;
  const rows=(catalog?.entries??[]).filter(row=>(!kind||row.kind===kind)&&(!term||JSON.stringify(row).toLowerCase().includes(term)));
  $('entry').replaceChildren(...rows.map(row=>new Option(row.name+' · '+row.kind,row.id)));
  $('entry').value=entry?.id??'';
  controls();
 }
 async function reload(preferred=entry?.id){
  const id=captureId(),scope=displayScope();
  if(!id||context()?.saved)throw Error('Return to a live or pinned producer capture to edit the catalog.');
  const next=await api(endpoint+'?'+new URLSearchParams({snapshot:id}));
  if(scope!==displayScope())return;
  catalog=next;
  frameScope=scope;
  entry=catalog.entries.find(row=>row.id===preferred)??null;
  fill();
  list();
 }
 function clearResult(){
  active=false;
  pinned=false;
  result=null;
  $('preview').hidden=true;
  $('instance').replaceChildren();
  if(imageUrl)URL.revokeObjectURL(imageUrl);
  imageUrl=null;
  controls();
 }
 function render(next){
  const previous=$('instance').value;
  result=next;
  const states={all:'All matches',following:'Following',missing:'Missing or occluded',lost:'Lost',ambiguous:'Ambiguous',unsupported:'Unavailable'};
  const movie=next.movie?.loaded?' · '+next.movie.filename+' frame '+(next.movie.timelineFrame??'after end'):'';
  say(states[next.state]+' · frame '+next.frame+movie+' · '+next.evidenceClass+
      (pinned?' · PINNED':'')+(next.reason?' · '+next.reason:' · '+next.candidates.length+' matches'));
  const options=next.candidates.map(candidate=>{
   const {x,y}=candidate.bounds;
   const locator=candidate.slot!==undefined?'SATB '+candidate.slot:'BAT $'+candidate.batWord.toString(16);
   return new Option(locator+' at '+x+', '+y,candidate.id);
  });
  $('instance').replaceChildren(new Option('Choose an instance',''),...options);
  $('instance').value=next.selection?.id??(options.some(option=>option.value===previous)?previous:options.length===1?options[0].value:'');
  $('preview').hidden=!next.image;
  if(imageUrl)URL.revokeObjectURL(imageUrl);
  imageUrl=null;
  if(next.image){
   imageUrl=URL.createObjectURL(new Blob([Uint8Array.from(atob(next.image),char=>char.charCodeAt(0))],{type:'image/png'}));
   $('image').src=imageUrl;
   const canvas=$('bounds');
   canvas.width=next.width;
   canvas.height=next.height;
   const ctx=canvas.getContext('2d');
   ctx.strokeStyle='#e4be7c';
   const targets=next.selection?[next.selection]:next.candidates;
   for(const {bounds:b} of targets)ctx.strokeRect(b.x+.5,b.y+.5,b.width-1,b.height-1);
  }
  controls();
 }
 function fields(){
  return {name:$('name').value,labels:$('labels').value.split(',').map(label=>label.trim()).filter(Boolean),notes:$('notes').value};
 }
 async function change(action,extra={}){
  if(!catalog)await reload();
  const snapshot=['create','append'].includes(action)?seed?.snapshot:captureId();
  const reply=await post(endpoint,{action,revision:catalog.revision,id:entry?.id,snapshot,...extra});
  catalog=reply.catalog;
  clearResult();
  entry=catalog.entries.find(row=>row.id===reply.selected)??entry;
  fill();
  list();
  say('Saved catalog revision '+catalog.revision+'.');
 }
 async function showAll(){
  if(!entry||!captureId())throw Error('Select a catalog entry first.');
  pinned=false;
  render(await observe({action:'all',snapshot:captureId(),id:entry.id,entryRevision:entry.revision}));
  active=context()?.kind==='live';
 }
 async function pinResult(){
  if(!result)throw Error('Show an observed catalog frame first.');
  active=false;
  const proof=await observe({action:'pin',ticket:result.ticket});
  if(proof.snapshot!==result.snapshot)throw Error('Tracked frame changed.');
  pinned=true;
  render(result);
  return {owner,ticket:proof.ticket};
 }

 $('entry').onchange=()=>{
  clearResult();
  entry=catalog?.entries.find(row=>row.id===$('entry').value)??null;
  fill();
  controls();
 };
 for(const id of ['search','filter'])$(id).oninput=list;
 $('instance').onchange=controls;
 $('reload').onclick=()=>run(async()=>{clearResult();await reload();say('Catalog reloaded.');});
 $('add').onclick=()=>run(()=>change('create',{...fields(),view:seed.view,x:seed.x,y:seed.y}));
 $('append').onclick=()=>run(()=>change('append',{view:seed.view,x:seed.x,y:seed.y}));
 $('edit').onclick=()=>run(()=>change('edit',{...fields(),selectors:JSON.parse($('selectors').value)}));
 $('all').onclick=()=>run(showAll);
 $('live').onclick=()=>run(async()=>{
  returnLive();
  const compatible=liveScope()?.toLowerCase()===catalog?.game.digest.value;
  if(!compatible){clearResult();await reload();return;}
  await showAll();
 });
 $('follow').onclick=()=>run(async()=>{
  const candidate=$('instance').value;
  pinned=false;
  render(await observe({action:'pick',snapshot:result.snapshot,id:entry.id,entryRevision:entry.revision,candidate}));
  returnLive();
  active=true;
 });
 $('pin').onclick=()=>run(pinResult);
 $('attach').onclick=()=>run(async()=>attachComment(await pinResult(),'observation'));
 $('bug').onclick=()=>run(async()=>attachComment(await pinResult(),'bug'));
 $('import').onchange=()=>run(async()=>{
  const file=$('import').files[0];
  if(!file)return;
  try{
   if(file.size>512*1024)throw Error('Catalog import exceeds 512 KiB.');
   await change('import',{catalog:JSON.parse(await file.text())});
  }finally{$('import').value='';}
 });
 $('export').onclick=()=>{
  if(!catalog)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(catalog,null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='pce-catalog-'+catalog.game.digest.value+'.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 setInterval(()=>{
  if(panel.hidden||document.hidden||busy)return;
  controls();
  if(captureId()&&!context()?.saved&&(displayScope()??'unavailable')!==frameScope){
   frameScope=displayScope()??'unavailable';
   run(async()=>{clearResult();await reload();});
   return;
  }
  if(!active||pinned||context()?.kind!=='live'||!entry||!liveContext())return;
  if(liveContext().id===result?.snapshot)return;
  run(async()=>{
   const next=await observe({action:'advance',id:entry.id,entryRevision:entry.revision});
   render(next);
   if(['lost','ambiguous','unsupported'].includes(next.state))active=false;
  });
 },120);
 setInterval(()=>{
  if(!panel.hidden&&!document.hidden&&!busy&&pinned&&result)run(async()=>{
   try{await observe({action:'pin',ticket:result.ticket});}
   catch(e){pinned=false;throw e;}
  });
 },30000);
 controls();
 return {
  async pick(c,point){
   const request=++seedRequest;
   seed=null;
   selectedPoint=c?{snapshot:c.meta.id,...point}:null;
   controls();
   if(!c||c.saved){$('pick-info').textContent='Pick a pixel on a live or frozen producer capture to see the available evidence.';return;}
   try{
    const next=await api(endpoint+'/pick?'+new URLSearchParams(selectedPoint));
    if(request!==seedRequest||context()?.meta.id!==c.meta.id)return;
    seed=next;
    $('pick-info').textContent=JSON.stringify(next,null,2);
   }catch(e){if(request===seedRequest)$('pick-info').textContent=e.message;}
   controls();
  }
 };
}
