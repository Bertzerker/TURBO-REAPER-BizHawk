// SPDX-License-Identifier: MIT
// Synthetic protocol fixture; does not establish native emulation correctness.
import {unpack} from '../protocol.mjs';
export function fixture(sequence=1){
 const domains=[{name:'Main Memory',size:8192,offset:0,endian:'Little',wordSize:1},{name:'VRAM1',size:65536,offset:8192,endian:'Big',wordSize:2}],offset=73728;
 const meta={type:'frame',schema:1,id:'a'.repeat(32)+'-'+sequence,session:'a'.repeat(32),frame:sequence,rom:{hash:'original-test',name:'synthetic protocol'},core:'PCEHawk',version:'2.11.1',identity:{native:'test',sync:'test'},domains,geometry:{width:4,height:4,topLine:18},ppu:{mpr:[255,248,0,0,0,0,0,0]},movie:{loaded:false},sprites:[],atlas:{offset,width:4,height:4,length:64,panels:[{view:'composite',x:0,y:0,width:4,height:4,kind:'captured-output',supported:true}]},tiles:{offset:offset+64,length:0,width:0,height:0},raster:{offset:offset+64,length:64,width:4,height:4,valid:true,generation:sequence}};
 const payload=Buffer.alloc(offset+128);payload.write('TURBO-REA');for(let i=0;i<16;i++){payload.writeUInt32LE(0xff0000ff,offset+i*4);payload.writeUInt32LE(65535,offset+64+i*4);}
 const json=Buffer.from(JSON.stringify(meta)),prefix=Buffer.alloc(4);prefix.writeUInt32LE(json.length);return unpack(Buffer.concat([prefix,json,payload]));
}
