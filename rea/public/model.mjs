// SPDX-License-Identifier: MIT
export function memoryRange(meta,space,start,length){
 const domain=meta?.domains?.find(d=>d.name===space);if(!domain)throw Error('Memory domain is unavailable');
 if(!Number.isSafeInteger(start)||start<0||start>=domain.size)throw Error('Offset must identify a byte inside this domain');
 if(!Number.isSafeInteger(length)||length<1||length>4096)throw Error('Length must be 1–4096 bytes');
 return {domain,start,length:Math.min(length,domain.size-start)};
}
export function comparisonReason(a,b,space){
 if(!a||!b)return 'Choose both evidence captures';
 if(a.rom?.hash!==b.rom?.hash)return 'Different ROMs cannot be compared';
 if(a.core!==b.core||a.version!==b.version)return 'Different core/build identities cannot be compared';
 if(a.identity?.sync!==b.identity?.sync||a.identity?.native!==b.identity?.native)return 'Different machine configuration or native build';
 const x=a.domains?.find(d=>d.name===space),y=b.domains?.find(d=>d.name===space);
 if(!x||!y||x.size!==y.size||x.endian!==y.endian||x.wordSize!==y.wordSize)return 'Memory domain layouts do not match';
 return '';
}
export class SelectionRequest {
 constructor(){this.generation=0;}
 invalidate(){return ++this.generation;}
 async select(context,point,pin,lookup){
  const generation=this.invalidate();
  try{
   await pin(context,generation);if(generation!==this.generation)return null;
   const result=await lookup(context,point);if(generation!==this.generation)return null;
   if(result.snapshot!==context.meta.id||result.view!==point.view||result.x!==point.x||result.y!==point.y)throw Error('Pixel response does not match the selected evidence');
   return {generation,context,point,result};
  }catch(e){if(generation!==this.generation)return null;throw e;}
 }
}
export function actionReason(action,{server=false,producer=false,live=null,pending=null,uncertain=false}={}){
 if(!server)return 'Viewer server is disconnected';
 if(!producer)return 'Waiting for emulator';
 if(!live)return 'Waiting for current emulator status';
 if(action==='pause')return '';
 if(uncertain)return 'Previous command outcome is unknown; requery state first';
 if(pending||live.execution?.pendingStep)return 'An execution command is pending; Pause can interrupt a bounded step';
 if(['record','play','checkpoint-load'].includes(action)&&live.movie?.mode==='RECORD')return 'Save and stop the recording first';
 if(['checkpoint-load','checkpoint-save'].includes(action)&&live.movie?.loaded)return 'Stop the active movie before using a general checkpoint';
 if(action==='record'&&live.movie?.loaded)return 'Stop the current movie before recording';
 if(['movie-save','movie-stop','movie-inputs'].includes(action)&&!live.movie?.loaded)return 'No active movie';
 if(action==='experiment'&&live.movie?.loaded&&live.movie.readOnly)return 'Read-only playback owns input; use movie input stepping';
 return '';
}

export function checkpointReason(info,live){
 if(!live)return 'Connect emulator to check compatibility';
 if(info.rom!==live.rom.hash)return 'Different ROM';
 if(info.core!==live.core)return 'Different core';
 if(info.version!==live.version)return 'Different BizHawk version';
 if(info.sync!==live.identity?.sync)return 'Different synchronization settings';
 if(info.native&&info.native!==live.identity?.native)return 'Different native core binary';
 return '';
}
