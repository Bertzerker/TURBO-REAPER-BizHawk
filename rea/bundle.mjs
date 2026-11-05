// SPDX-License-Identifier: MIT — bounded ZIP32 (stored entries), no npm runtime.
import {createHash} from 'node:crypto';
let table;
function crc32(b){table??=Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function zip(files){
 const parts=[],central=[];let offset=0,total=0;
 for(const [name,value]of Object.entries(files)){
  if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw Error('Unsafe bundle filename');
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value),filename=Buffer.from(name),crc=crc32(bytes);total+=bytes.length;if(total>256*1024*1024)throw Error('Investigation exceeds 256 MiB limit');
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt32LE(crc,14);head.writeUInt32LE(bytes.length,18);head.writeUInt32LE(bytes.length,22);head.writeUInt16LE(filename.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(bytes.length,20);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);
  parts.push(head,filename,bytes);central.push(directory,filename);offset+=head.length+filename.length+bytes.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);
}
export function investigation(files,meta,note=null){
 const payload={...files,'VERIFY.md':'Inspection evidence, not a restorable checkpoint. Verify each manifest.json file SHA256 and byte length before using evidence. Preserve ROM/core/movie versions for replay.\n'};
 const manifest={schema:1,type:'TURBO REAPER investigation',inspectionSnapshot:true,restorableCheckpoint:false,capture:{id:meta.id,frame:meta.frame,rom:meta.rom,core:meta.core,version:meta.version,identity:meta.identity,geometry:meta.geometry,timing:meta.timing,firmware:"none required for standard HuCard",generation:meta.raster?.generation},annotation:note?{id:note.id,revision:note.revision}:null,files:Object.entries(payload).map(([name,bytes])=>({name,bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')}))};
 return zip({...payload,'manifest.json':JSON.stringify(manifest,null,2)});
}
