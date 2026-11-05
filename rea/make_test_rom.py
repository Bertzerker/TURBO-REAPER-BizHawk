# SPDX-License-Identifier: MIT
"""Original 8 KiB HuCard diagnostic. Tiny label assembler, no external assets/tools.
RAM $2000: signature, $2010: vblank count, $2011/$2012: active-low pad nibbles.
Palette #1 changes red -> green at raster 128, then blue in vblank.
Two sprites overlap the BG: front at x64, behind at x96. SATB uses VDC DMA.
"""
from pathlib import Path
import struct,json,hashlib,argparse
parser=argparse.ArgumentParser();parser.add_argument("--width",type=int,choices=[256,320,512],default=256);parser.add_argument("--sprite-stress",action="store_true");opt=parser.parse_args()
class Asm:
 def __init__(self): self.code=bytearray();self.labels={};self.fix=[]
 def emit(self,*v): self.code.extend(v)
 def label(self,n): self.labels[n]=0xe000+len(self.code)
 def word(self,v): self.code.extend(struct.pack('<H',v))
 def abs(self,op,v): self.emit(op);self.word(v)
 def jump(self,op,n): self.emit(op);self.fix.append((len(self.code),n,False));self.word(0)
 def branch(self,op,n): self.emit(op);self.fix.append((len(self.code),n,True));self.emit(0)
 def lda(self,v): self.emit(0xa9,v)
 def sta(self,v): self.abs(0x8d,v)
 def store(self,addr,v): self.lda(v);self.sta(addr)
 def vdc(self,r,v): self.emit(0x03,r,0x13,v&255,0x23,v>>8)
 def transfer(self,n,dst,length):
  self.emit(0xe3);self.fix.append((len(self.code),n,False));self.word(0);self.word(dst);self.word(length)
 def finish(self):
  for at,n,rel in self.fix:
   v=self.labels[n]-(0xe000+at+1) if rel else self.labels[n]
   if rel:
    assert -128<=v<=127,(n,v)
    self.code[at]=v&255
   else: self.code[at:at+2]=struct.pack('<H',v)
  assert len(self.code)<0x1ff6
  self.code.extend(bytes([0xea])*(0x2000-len(self.code)))
  for off in range(0x1ff6,0x2000,2): self.code[off:off+2]=struct.pack('<H',self.labels['reset'] if off==0x1ffe else self.labels['irq'])
  return self.code

a=Asm();a.label('reset');a.emit(0x78,0xd8,0xd4) # SEI CLD CSH
for mask,v in [(1,255),(2,248)]: a.lda(v);a.emit(0x53,mask)
a.emit(0xa2,255,0x9a) # stack in mapped RAM
for i,v in enumerate(b'TURBO-REA'): a.store(0x2000+i,v)
a.store(0x2010,0);a.store(0x1402,0);a.store(0x0c01,0) # IRQ mask, timer off
for r,v in [(5,0),(9,0),(10,0x0202),(11,0x0300+(opt.width//8-1)),(12,0x0f02),(13,223),(14,3),(7,0),(8,0)]:a.vdc(r,v)
# 512-entry palette, initially dark blue with contrasting foreground and sprite colors
a.store(0x0400,{256:0,320:1,512:2}[opt.width]);a.store(0x0402,0);a.store(0x0403,0)
a.transfer('palette',0x0404,1024)
# pattern 64 at VRAM word $400, sprite pattern $1000, SATB $1800
for word,label,length in [(0,'bat',2048),(0x400,'patterns',64),(0x1000,'sprite',128),(0x1800,'satb',512)]:
 a.vdc(0,word);a.emit(0x03,2);a.transfer(label,2,length)
a.vdc(15,0x10);a.vdc(19,0x1800);a.vdc(6,128);a.vdc(5,0xcc)
a.emit(0x58);a.label('idle');a.jump(0x4c,'idle')
a.label('irq');a.emit(0x48,0xda);a.abs(0xad,0);a.emit(0x29,0x20);a.branch(0xf0,'raster')
a.abs(0xee,0x2010)
# vblank end memory differs from both displayed palette phases
a.store(0x0402,1);a.store(0x0403,0);a.store(0x0404,7);a.store(0x0405,0) # blue
# restore scroll at vblank and poll pad using CLR/SEL handshake
a.vdc(7,0);a.store(0x1000,3);a.store(0x1000,1);a.abs(0xad,0x1000);a.sta(0x2011);a.store(0x1000,0);a.abs(0xad,0x1000);a.sta(0x2012)
# arm line 64 for red; line 128 for green
# next frame raster compare counter starts $40
# first IRQ at $40+16
# vblank setting will hold until line16, producing an initial blue band
a.vdc(6,80);a.store(0x2013,0);a.jump(0x4c,'done')
a.label('raster');a.abs(0xad,0x2013);a.branch(0xd0,'green')
a.store(0x0402,1);a.store(0x0403,0);a.store(0x0404,0x38);a.store(0x0405,0);a.vdc(7,0);a.vdc(6,128);a.store(0x2013,1);a.jump(0x4c,'done')
a.label('green');a.store(0x0402,1);a.store(0x0403,0);a.store(0x0404,0xc0);a.store(0x0405,1);a.vdc(7,8)
a.label('done');a.emit(0xfa,0x68,0x40)
a.label('palette')
for i in range(512): a.word(0x7 if i%16==0 else 0x38 if i<256 else 0x1ff)
a.label('bat')
for y in range(32):
 for x in range(32): a.word(64+(x%2))
a.label('patterns')
# tile64 solid index1, tile65 alternating transparent/index1
for t in range(2):
 for y in range(8): a.word(0xff if t==0 else 0xaa)
 for y in range(8): a.word(0)
a.label('sprite')
for plane in range(4):
 for y in range(16): a.word(0xffff if plane==0 else 0)
a.label('satb')
for i in range(64):
 for v in ([64+48,32-8+i*12,0x80,0x80] if opt.sprite_stress and i<18 else [0,0,0,0] if opt.sprite_stress else [64+48,32+64+i*32,0x80,0x80 if i==0 else 0] if i<2 else [0,0,0,0]): a.word(v)
rom=a.finish();out=Path(__file__).parent/'test-output';out.mkdir(exist_ok=True);p=out/('rea-diagnostic-stress.pce' if opt.sprite_stress else 'rea-diagnostic.pce' if opt.width==256 else f'rea-diagnostic-{opt.width}.pce');p.write_bytes(rom)
(out/'diagnostic-symbols.json').write_text(json.dumps(a.labels,indent=2))
print(json.dumps({'rom':str(p),'bytes':len(rom),'sha256':hashlib.sha256(rom).hexdigest()}))
