// SPDX-License-Identifier: MIT
// Lossless 32-bit literal/repeat runs, with raw fallback. No deflate workers.
export class WordRuns {
 constructor(){this.scratch=new Uint8Array(0);}
 encode(bytes){
  if(bytes.length%4)throw Error('Word payload must be aligned');
  if(this.scratch.length<bytes.length+16)this.scratch=new Uint8Array(bytes.length+16);
  const input=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=new DataView(this.scratch.buffer);
  const n=bytes.length/4;let i=0,p=0,literal=0;
  const literals=end=>{if(end===literal)return true;const count=end-literal;if(p+4+count*4>=bytes.length)return false;out.setUint32(p,count,true);p+=4;this.scratch.set(bytes.subarray(literal*4,end*4),p);p+=count*4;return true;};
  while(i<n){
   const word=input.getUint32(i*4,true);let end=i+1;
   while(end<n&&input.getUint32(end*4,true)===word)end++;
   if(end-i>=3){if(!literals(i)||p+8>=bytes.length)return {codec:'raw',bytes};out.setUint32(p,(end-i)|0x80000000,true);out.setUint32(p+4,word,true);p+=8;literal=end;}
   i=end;
  }
  if(!literals(n))return {codec:'raw',bytes};
  return {codec:'word-rle-v1',bytes:this.scratch.subarray(0,p)};
 }
}
export function expandWords(encoded,length,target){
 if(!Number.isSafeInteger(length)||length<0||length%4||length>32*1024*1024)throw Error('Invalid expanded length');
 const output=target?.length===length?target:new Uint8Array(length),src=new DataView(encoded.buffer,encoded.byteOffset,encoded.byteLength),dst=new DataView(output.buffer,output.byteOffset,output.byteLength);
 const words=output.byteOffset%4===0&&new Uint8Array(new Uint32Array([1]).buffer)[0]===1?new Uint32Array(output.buffer,output.byteOffset,length/4):null;
 let p=0,q=0;
 while(p<encoded.length){
  if(p+4>encoded.length)throw Error('Truncated run');const tag=src.getUint32(p,true);p+=4;const count=tag&0x7fffffff,size=count*4;
  if(!count||q+size>length)throw Error('Invalid run length');
  if(tag&0x80000000){if(p+4>encoded.length)throw Error('Truncated repeat');const value=src.getUint32(p,true);p+=4;if(words){words.fill(value,q/4,(q+size)/4);q+=size;}else for(let end=q+size;q<end;q+=4)dst.setUint32(q,value,true);}
  else{if(p+size>encoded.length)throw Error('Truncated literals');output.set(encoded.subarray(p,p+size),q);p+=size;q+=size;}
 }
 if(q!==length)throw Error('Incomplete word payload');return output;
}
export function decodeStream(packet){
 const bytes=packet instanceof Uint8Array?packet:new Uint8Array(packet),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<4)throw Error('Short stream packet');const n=view.getUint32(0,true);if(n>1_000_000||n+4>bytes.length)throw Error('Invalid stream metadata');
 const meta=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+n))),payload=bytes.subarray(4+n),t=meta.transport;
 if(!t)return {meta,bytes:payload};
 if(t.encodedLength!==payload.length)throw Error('Invalid transport length');
 if(t.codec==='word-rle-v1')return {meta,bytes:expandWords(payload,t.rawLength)};
 if(t.codec!=='raw'||t.rawLength!==payload.length)throw Error('Unsupported transport');return {meta,bytes:payload};
}
export class StreamDecoder {
 constructor(){this.free=[];}
 decode(packet){
  const bytes=packet instanceof Uint8Array?packet:new Uint8Array(packet),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  if(bytes.length<4)throw Error('Short stream packet');const n=v.getUint32(0,true);if(n>1_000_000||n+4>bytes.length)throw Error('Invalid stream metadata');
  const meta=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+n))),payload=bytes.subarray(4+n),t=meta.transport;
  const length=t?.rawLength??payload.length;if(!Number.isSafeInteger(length)||length<0||length>32*1024*1024)throw Error('Invalid decoded size');
  const index=this.free.findIndex(b=>b.length===length),target=index<0?new Uint8Array(length):this.free.splice(index,1)[0];
  if(t&&t.encodedLength!==payload.length)throw Error('Invalid transport length');
  if(t?.codec==='word-rle-v1')expandWords(payload,length,target);
  else {if(t&&t.codec!=='raw'||payload.length!==length)throw Error('Unsupported transport');target.set(payload);}
  return {meta,bytes:target,released:false};
 }
 release(frame){if(!frame||frame.released)return;frame.released=true;if(this.free.length<16)this.free.push(frame.bytes);}
}
