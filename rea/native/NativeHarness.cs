// SPDX-License-Identifier: MIT
// Executes the actual managed core without a frontend throttle or protocol fixture.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using BizHawk.Emulation.Common;
using BizHawk.Emulation.Cores;
using BizHawk.Emulation.Cores.PCEngine;
using Newtonsoft.Json;
using TurboReaper;
class NativeHarness {
 sealed class Rom:IRomAsset {
  public byte[] RomData {get;set;}public byte[] FileData=>RomData;public string Extension=>".pce";public string RomPath=>"original diagnostic";public GameInfo Game{get;set;}
 }
 static string Hash(byte[] b){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(b)).Replace("-","");}
 static PCEngine Create(byte[] rom){var game=new GameInfo{Name="Original REA diagnostic",System="PCE"};return new PCEngine(new CoreLoadParameters<PCEngine.PCESettings,PCEngine.PCESyncSettings>{Game=game,Settings=new PCEngine.PCESettings{SpriteLimit=true},Roms=new List<IRomAsset>{new Rom{RomData=rom,Game=game}}});}
 static void Main(string[] args){
  byte[] rom=File.ReadAllBytes(args[0]);var rows=new List<object>();string expectedState=null,expectedOutput=null;
  foreach(bool enabled in new[]{false,true,false,true})using(var pc=Create(rom)){
   var f=PceRasterObserver.Get(pc.VDC1);f.Enabled=enabled;
   for(int i=0;i<60;i++)pc.FrameAdvance(NullController.Instance,true,true);
   var times=new List<double>();var clock=Stopwatch.StartNew();
   for(int i=0;i<1800;i++){var t=Stopwatch.StartNew();pc.FrameAdvance(NullController.Instance,true,true);times.Add(t.Elapsed.TotalMilliseconds);}
   times.Sort();byte[] video=new byte[pc.VDC1.BufferWidth*pc.VDC1.BufferHeight*4];Buffer.BlockCopy(pc.VDC1.GetVideoBuffer(),0,video,0,video.Length);
   string state=Hash(pc.AsStatable().CloneSavestate()),output=Hash(video);
   if(expectedState!=null&&(expectedState!=state||expectedOutput!=output))throw new Exception("Observation changed machine state/output");expectedState=state;expectedOutput=output;
   rows.Add(new {enabled,elapsedMs=clock.Elapsed.TotalMilliseconds,p50=times[times.Count/2],p95=times[(int)(times.Count*.95)],state,output,valid=f.Valid,width=pc.VDC1.BufferWidth,height=pc.VDC1.BufferHeight});
  }
  object stress=null;
  if(args[0].Contains("stress"))using(var pc=Create(rom)){
   for(int i=0;i<10;i++)pc.FrameAdvance(NullController.Instance,true,true);
   var f=PceRasterObserver.Get(pc.VDC1);int limited=f.SpriteId.Max();if(limited!=15)throw new Exception("16-sprite renderer limit mismatch");
   pc.Settings.SpriteLimit=false;pc.FrameAdvance(NullController.Instance,true,true);int unlimited=f.SpriteId.Max();if(unlimited!=15)throw new Exception("Unknown-ROM forced sprite limit mismatch");
   if(f.SpriteId[47*pc.VDC1.BufferWidth]!=0)throw new Exception("Left-clipped sprite capture mismatch");
   pc.Settings.ShowOBJ1=false;pc.FrameAdvance(NullController.Instance,true,true);if(f.SpriteId.Max()!=-1||!f.Valid)throw new Exception("Hidden sprites must be a valid blank layer");
   stress=new {limited,afterDisablingSetting=unlimited,forcedForUnknownRom=true,leftClipping=true,validBlank=true};
  }
  Console.WriteLine(JsonConvert.SerializeObject(new {rom=Hash(rom),frames=1800,rows,stress}));
 }
}
