// SPDX-License-Identifier: MIT
// Detached worker buffers; no emulator calls on the encoder thread.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using Newtonsoft.Json;
namespace REATurbo {
 sealed class CaptureWork {
  public readonly Dictionary<string,byte[]> Memory=new Dictionary<string,byte[]>();
  public readonly List<byte[]> Blocks=new List<byte[]>();
  public Dictionary<string,object> Header;
  public int Width,Height,MemoryLength,BatWidth,BatHeight,TopLine,ViewStartLine; public bool Valid;public string Reason;public long Generation;
  public int[] Video=new int[0],Background=new int[0],Sprites=new int[0],Source=new int[0],Palette;
  public short[] SpriteId=new short[0];public ushort[] PaletteIndex=new ushort[0],Sat,Vram;public byte[] Pattern;
  int[] atlas=new int[0],samples=new int[0];readonly int[] tiles=new int[128*128];byte[] packet=new byte[0];public int PacketLength;
  public void Prepare(int n){if(Video.Length!=n){Video=new int[n];Background=new int[n];Sprites=new int[n];Source=new int[n];SpriteId=new short[n];PaletteIndex=new ushort[n];samples=new int[n];}}
  public byte[] Encode(){
   var watch=Stopwatch.StartNew();int cw=Math.Max(256,Width),ch=Math.Max(256,Height),aw=cw*3,ah=ch*2,n=Width*Height;
   if(atlas.Length!=aw*ah)atlas=new int[aw*ah];Array.Clear(atlas,0,atlas.Length);
   var panels=new List<object>();string[] names={"composite","bg1","obj","source","bat","palette"};
   for(int slot=0;slot<6;slot++){
    int px=slot%3*cw,py=slot/3*ch,pw=slot==4?Math.Min(BatWidth*8,cw):slot==5?256:Width,ph=slot==4?Math.Min(BatHeight*8,ch):slot==5?128:Height;
    bool supported=slot>=4||Valid;
    panels.Add(new {view=names[slot],x=px,y=py,width=pw,height=ph,kind=slot>=4?"memory-diagnostic":slot==0?Valid?"captured-output":"cached-output":"captured-input",supported=slot==0||supported});
    if(slot<4){var data=slot==0?Video:slot==1?Background:slot==2?Sprites:Source;if(slot==0||Valid)for(int y=0;y<Height;y++)Array.Copy(data,y*Width,atlas,(py+y)*aw+px,Width);}
    else if(slot==4){for(int y=0;y<ph;y++)for(int x=0;x<pw;x++){int ent=Vram[(y/8)*BatWidth+x/8],tile=ent&2047,c=Pattern[tile*64+(y%8)*8+x%8];atlas[(py+y)*aw+px+x]=Palette[c==0?0:(ent>>12)*16+c]|unchecked((int)0xff000000);}}
    else for(int y=0;y<ph;y++)for(int x=0;x<pw;x++)atlas[(py+y)*aw+px+x]=Palette[(y/8)*32+x/8]|unchecked((int)0xff000000);
   }
   for(int t=0;t<256;t++)for(int y=0;y<8;y++)for(int x=0;x<8;x++)tiles[(t/16*8+y)*128+t%16*8+x]=Palette[Pattern[t*64+y*8+x]]|unchecked((int)0xff000000);
   var sprites=new List<object>();int top=TopLine,start=ViewStartLine;
   for(int i=0;i<64;i++){int at=i*4,f=Sat[at+3];sprites.Add(new {index=i,x=(Sat[at+1]&1023)-32,y=(Sat[at]&1023)-64+start-top,width=(f&256)==0?16:32,height=new[]{16,32,64,64}[(f>>12)&3],tile=(Sat[at+2]>>1)&511,palette=f&15,priority=(f&128)!=0,hflip=(f&2048)!=0,vflip=(f&32768)!=0,sampling="completed-frame SATB; not raster bounds or game hitboxes"});}
   for(int i=0;i<n;i++)samples[i]=Valid?(ushort)SpriteId[i]|PaletteIndex[i]<<16:65535;
   int aSize=atlas.Length*4,tSize=tiles.Length*4,rSize=Valid?n*4:0;
   Header["sprites"]=sprites;Header["bgs"]=new[]{new {index=1,batWidth=BatWidth,batHeight=BatHeight,sampling="completed-frame diagnostic"}};Header["palette"]=Palette;
   Header["atlas"]=new {width=aw,height=ah,format="BGRA8888",offset=MemoryLength,length=aSize,panels};
   Header["tiles"]=new {width=128,height=128,format="BGRA8888",offset=MemoryLength+aSize,length=tSize,kind="background-pattern-memory-diagnostic"};
   Header["raster"]=new {available=true,valid=Valid,generation=Generation,reason=Reason,width=Width,height=Height,offset=MemoryLength+aSize+tSize,length=rSize,format="uint32 LE: sprite index signed16, palette index unsigned16; -1 means no admitted sprite",accuracy="PCEHawk scanline/cache renderer; no subscanline or exact fetch provenance"};
   Header["encode_ms"]=watch.Elapsed.TotalMilliseconds;
   byte[] json=Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(Header));int size=4+json.Length+MemoryLength+aSize+tSize+rSize;
   PacketLength=size+4;if(packet.Length<PacketLength)packet=new byte[PacketLength];Buffer.BlockCopy(BitConverter.GetBytes(size),0,packet,0,4);Buffer.BlockCopy(BitConverter.GetBytes(json.Length),0,packet,4,4);Buffer.BlockCopy(json,0,packet,8,json.Length);
   int off=8+json.Length;foreach(var b in Blocks){Buffer.BlockCopy(b,0,packet,off,b.Length);off+=b.Length;}
   Buffer.BlockCopy(atlas,0,packet,off,aSize);off+=aSize;Buffer.BlockCopy(tiles,0,packet,off,tSize);off+=tSize;if(rSize>0)Buffer.BlockCopy(samples,0,packet,off,rSize);return packet;
  }
 }
}
