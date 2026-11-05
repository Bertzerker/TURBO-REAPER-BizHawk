// SPDX-License-Identifier: MIT
// External inspection tool for BizHawk 2.11.1 with the REA native PPU extension.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using BizHawk.Client.Common;
using BizHawk.Client.EmuHawk;
using BizHawk.Common;
using BizHawk.Emulation.Common;
using BizHawk.Emulation.Cores.PCEngine;
using TurboReaper;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;


namespace REATurbo {
 [ExternalTool("TURBO REAPER", Description="Synchronized graphics, memory, input movies and AI control")]
 [ExternalToolApplicability.SingleSystem("PCE")]
 public sealed class Inspector : ToolFormBase, IExternalToolForm {
  public ApiContainer _apiContainer { get; set; }
  [RequiredService] public IEmulator Emulator { get; set; }
  [RequiredService] public IMemoryDomains MemoryDomains { get; set; }

  protected override string WindowTitleStatic => "TURBO REAPER bridge";
  readonly string session = Guid.NewGuid().ToString("N");
  readonly string root = Environment.GetEnvironmentVariable("REA_TG16_ROOT") ?? Path.GetFullPath("../rea");
  readonly ConcurrentQueue<JObject> commands = new ConcurrentQueue<JObject>();
  readonly ConcurrentQueue<byte[]> replies = new ConcurrentQueue<byte[]>();
  readonly AutoResetEvent ready = new AutoResetEvent(false);
  readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval=16 };
  readonly Label status = new Label { Dock=DockStyle.Fill, Padding=new Padding(12), AutoSize=false };
  volatile bool closed;
  readonly ConcurrentQueue<CaptureWork> captures = new ConcurrentQueue<CaptureWork>();
  readonly ConcurrentQueue<CaptureWork> free = new ConcurrentQueue<CaptureWork>();
  long sequence, skipped;
  int running, steps, every=1;
  int stepStart,stepRequested;
  volatile bool transportConnected;
  string nativeIdentity;
  Dictionary<string,bool> stepInput;
  string stepCommand;
  RasterCapture raster;
  bool rasterEnabled=Environment.GetEnvironmentVariable("REA_TG16_RASTER_CAPTURE")!="0";
  IEmuClientApi watchedClient;
  long lastRenderGeneration=-1;
  int lastRenderFrame=-1;
  Stopwatch clock = Stopwatch.StartNew();
  long lastCapture;
  string stepLastSnapshot;
  public Inspector() {
   for(int i=0;i<6;i++)free.Enqueue(new CaptureWork());
   ClientSize = new Size(580,160); Controls.Add(status);
   string nativePath=Path.GetFullPath(Path.Combine(root,"../emulator/dll/BizHawk.Emulation.Cores.dll"));
   using(var sha=SHA256.Create())nativeIdentity=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(nativePath).Concat(File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(nativePath),"TURBO.REA.Observer.dll"))).Concat(File.ReadAllBytes(typeof(Inspector).Assembly.Location)).ToArray())).Replace("-","");
   timer.Tick += (_,__) => Tick();
   Shown += (_,__) => { WatchStates();timer.Start();new Thread(Transport){IsBackground=true,Name="TURBO REAPER encoder/transport"}.Start(); };
   FormClosed += (_,__) => { closed=true; timer.Stop(); ready.Set();if(watchedClient!=null)watchedClient.StateLoaded-=StateLoaded; };
  }
  public override void Restart() {
   raster=null;
   lastRenderGeneration=-1;lastRenderFrame=-1;WatchStates();
   // Frame numbers can rewind; session + sequence remains unique.
   lastCapture=0;
  }
  void WatchStates() {
   if(_apiContainer==null || ReferenceEquals(watchedClient,_apiContainer.EmuClient))return;
   if(watchedClient!=null)watchedClient.StateLoaded-=StateLoaded;
   watchedClient=_apiContainer.EmuClient;watchedClient.StateLoaded+=StateLoaded;
  }
  void StateLoaded(object sender,StateLoadedEventArgs e) {raster?.Invalidate();lastRenderFrame=-1;}
  void Tick() {
   if (_apiContainer==null || Emulator==null) return;
   while (commands.TryDequeue(out var c)) {
    try { Execute(c); } catch(Exception e) { Reply(c, false, new { error=e.Message }); }
   }
   if (steps>0 && running==0) _apiContainer.EmuClient.DoFrameAdvance();
   if (_apiContainer.EmuClient.IsPaused() && steps==0 && clock.ElapsedMilliseconds-lastCapture>500) Capture();
  }
  public override void UpdateValues(ToolFormUpdateType type) {
   if (_apiContainer==null) return;
   if (type==ToolFormUpdateType.PreFrame || type==ToolFormUpdateType.FastPreFrame) {
    if(Emulator is PCEngine pc) { raster=PceRasterObserver.Get(pc.VDC1);raster.Enabled=rasterEnabled; }
    if (steps>0 && stepInput!=null) _apiContainer.Joypad.Set(stepInput);
    running=1;
   }
   if (type!=ToolFormUpdateType.PostFrame && type!=ToolFormUpdateType.FastPostFrame) return;
   running=0;
   if (steps>0) {
    steps--;
    _apiContainer.EmuClient.Pause();
    if (steps==0) {
     Capture(true);
     Reply(new JObject { ["requestId"]=stepCommand }, true, new {frame=Emulator.Frame,snapshot=stepLastSnapshot,requestedFrames=stepRequested,completedFrames=Emulator.Frame-stepStart});
     stepInput=null; stepCommand=null;
     return;
    }
   }
   if (Emulator.Frame%every==0) Capture();
  }
  static byte[] Packet(object header, params byte[][] blocks) {
   byte[] json=Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(header));
   int size=4+json.Length+blocks.Sum(b=>b.Length);
   var packet=new byte[size+4];
   Buffer.BlockCopy(BitConverter.GetBytes(size),0,packet,0,4);
   Buffer.BlockCopy(BitConverter.GetBytes(json.Length),0,packet,4,4);
   Buffer.BlockCopy(json,0,packet,8,json.Length);
   int offset=8+json.Length;
   foreach(var block in blocks) { Buffer.BlockCopy(block,0,packet,offset,block.Length); offset+=block.Length; }
   return packet;
  }
  void Reply(JObject c, bool ok, object result) {
   replies.Enqueue(Packet(new {type="reply", requestId=(string)c["requestId"],ok,result})); ready.Set();
  }
  void Execute(JObject c) {
   string action=(string)c["action"];
   if (steps>0 && action!="pause" && action!="shutdown") throw new InvalidOperationException("A bounded input step is still running");
   switch(action) {
    case "pause":
     _apiContainer.EmuClient.Pause();
     if(steps>0) {
      Reply(new JObject {["requestId"]=stepCommand},false,new {error="Input step interrupted by pause",frame=Emulator.Frame,requestedFrames=stepRequested,completedFrames=Emulator.Frame-stepStart});
      steps=0;stepInput=null;stepCommand=null;
     }
     break;
    case "shutdown":
     _apiContainer.EmuClient.Pause();
     Reply(c,true,new {frame=Emulator.Frame});
     Task.Delay(300).ContinueWith(_=>{if(!closed)BeginInvoke(new Action(()=>_apiContainer.EmuClient.CloseEmulator()));});
     return;
    case "resume": _apiContainer.EmuClient.Unpause(); break;
    case "speed": {
     int percent=(int?)c["percent"]??100;
     if(!new[]{10,25,50,75,100,150,200,400}.Contains(percent))throw new ArgumentException("Unsupported playback speed");
     _apiContainer.EmuClient.SpeedMode(percent);break;
    }
    case "step":
     int count=(int?)c["frames"]??1;
     if(count<1 || count>3600) throw new ArgumentException("frames must be 1..3600");
     if (_apiContainer.Movie.IsLoaded() && _apiContainer.Movie.GetReadOnly() && c["buttons"]!=null)
      throw new InvalidOperationException("Read-only movie playback owns inputs. Finish/stop it or explicitly enable rerecording in BizHawk.");
     _apiContainer.EmuClient.Pause();
     stepInput=Emulator.ControllerDefinition.BoolButtons.ToDictionary(b=>b,b=>false);
     foreach(var p in (c["buttons"] as JObject ?? new JObject()).Properties()) {
      if(!stepInput.ContainsKey(p.Name)) throw new ArgumentException("Unknown controller button: "+p.Name);
      if(p.Value.Type!=JTokenType.Boolean) throw new ArgumentException("Button values must be boolean");
      stepInput[p.Name]=(bool)p.Value;
     }
     if(c["buttons"]==null && _apiContainer.Movie.IsLoaded()) stepInput=null;
     stepStart=Emulator.Frame;stepRequested=count;steps=count; stepCommand=(string)c["requestId"]; return;
    case "record": {
     if(_apiContainer.Movie.IsLoaded()) throw new InvalidOperationException("Save/stop the current movie before recording another");
     string path=LocalPath("movies", (string)c["name"], ".bk2");
     if(File.Exists(path)) throw new IOException("Movie already exists");
     var movie=MovieSession.Get(path, false); movie.Author=(string)c["author"]??"REA";
     if((string)c["start"]=="checkpoint") {
      movie.StartsFromSavestate=true;
      movie.BinarySavestate=Emulator.AsStatable().CloneSavestate();
     } else if((string)c["start"]!="poweron" && c["start"]!=null) throw new ArgumentException("start must be poweron or checkpoint");
     if(!MainForm.StartNewMovie(movie, true)) throw new InvalidOperationException("BizHawk refused movie recording");
     _apiContainer.EmuClient.Pause(); break;
    }
    case "movie-save":
     if(!_apiContainer.Movie.IsLoaded()) throw new InvalidOperationException("No active movie");
     _apiContainer.Movie.Save(); break;
    case "movie-stop": _apiContainer.Movie.Stop(true); break;
    case "play": {
     if(_apiContainer.Movie.IsLoaded()) {
      if(_apiContainer.Movie.Mode()=="RECORD")throw new InvalidOperationException("Save/stop the recording before loading another movie");
      _apiContainer.Movie.Stop(true);
     }
     string path=LocalPath("movies", (string)c["name"], ".bk2");
     if(!File.Exists(path)) throw new IOException("Movie does not exist");
     _apiContainer.Movie.SetReadOnly(true);
     if(!_apiContainer.Movie.PlayFromStart(path)) throw new InvalidOperationException("Movie load failed");
     _apiContainer.EmuClient.Pause(); break;
    }
    case "checkpoint-save": {
     if(_apiContainer.Movie.IsLoaded())throw new InvalidOperationException("Stop the active movie before saving a general checkpoint");
     string path=LocalPath("checkpoints",(string)c["name"],".State");
     if(File.Exists(path)) throw new IOException("Checkpoint already exists");
     _apiContainer.SaveState.Save(path,true);
     if(!File.Exists(path)) throw new IOException("Checkpoint was not saved");
     File.WriteAllText(path+".json",JsonConvert.SerializeObject(new {rom=Game.Hash,core=Emulator.GetType().FullName,version="2.11.1",sync=SyncIdentity(),native=nativeIdentity,frame=Emulator.Frame,stateSha256=FileHash(path)}));
     break;
    }
    case "checkpoint-load": {
     if(_apiContainer.Movie.IsLoaded())throw new InvalidOperationException("Stop the active movie before restoring a general checkpoint");
     string path=LocalPath("checkpoints",(string)c["name"],".State");
     var identity=JObject.Parse(File.ReadAllText(path+".json"));
     if((string)identity["rom"]!=Game.Hash || (string)identity["core"]!=Emulator.GetType().FullName || (string)identity["version"]!="2.11.1" || (string)identity["sync"]!=SyncIdentity()) throw new InvalidOperationException("Checkpoint ROM/core/version/sync-settings mismatch");
     if(identity["native"]!=null&&(string)identity["native"]!=nativeIdentity)throw new InvalidOperationException("Checkpoint native core binary mismatch");
     if((string)identity["stateSha256"]!=FileHash(path))throw new InvalidOperationException("Checkpoint state integrity mismatch");
     if(!_apiContainer.SaveState.Load(path,true)) throw new InvalidOperationException("Checkpoint load failed");
     _apiContainer.EmuClient.Pause(); break;
    }
    case "tastudio": _apiContainer.Tool.OpenTasStudio(); break;
    case "capture-rate": every=(int?)c["every"]??1; if(every<1 || every>60) {every=1;throw new ArgumentException("every must be 1..60");} break;
    case "raster-enable":
     if(c["enabled"]?.Type!=JTokenType.Boolean)throw new ArgumentException("enabled must be a boolean");
     rasterEnabled=(bool)c["enabled"];if(raster!=null){raster.Enabled=rasterEnabled;raster.Invalidate();}break;
    case "state-hash": {
     if(!_apiContainer.EmuClient.IsPaused())throw new InvalidOperationException("Pause before hashing core state");
     using(var sha=SHA256.Create()) Reply(c,true,new {frame=Emulator.Frame,sha256=BitConverter.ToString(sha.ComputeHash(Emulator.AsStatable().CloneSavestate())).Replace("-","")});
     return;
    }
    case "movie-inputs": {
     int start=(int?)c["start"]??0,length=(int?)c["length"]??120;
     if(!_apiContainer.Movie.IsLoaded() || start<0 || length<1 || length>4096 || start+length>_apiContainer.Movie.Length()) throw new ArgumentException("Invalid active movie input range");
     var input=Enumerable.Range(start,length).Select(f=>new {frame=f,buttons=_apiContainer.Movie.GetInput(f),mnemonic=_apiContainer.Movie.GetInputAsMnemonic(f)}).ToArray();
     Reply(c,true,input); return;
    }
    default: throw new ArgumentException("Unknown action");
   }
   Capture(true); Reply(c,true,new {frame=Emulator.Frame,snapshot=stepLastSnapshot,paused=_apiContainer.EmuClient.IsPaused()});
  }
  static string FileHash(string path){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-","");}
  string SyncIdentity() {
   var method=Emulator.GetType().GetMethod("GetSyncSettings");
   if(method==null) throw new InvalidOperationException("Core does not expose synchronization settings");
   using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new {sync=method.Invoke(Emulator,null),settings=(Emulator as PCEngine)?.Settings,database=new {unknownRom=Game.NotInDatabase,options=Field(Game,"<Options>k__BackingField")}})))).Replace("-","");
  }
  string LocalPath(string folder,string name,string extension) {
   if(string.IsNullOrEmpty(name) || name.Length>100 || name.Any(ch=>!char.IsLetterOrDigit(ch) && ch!='-' && ch!='_')) throw new ArgumentException("Use a name containing letters, numbers, - or _");
   string dir=Path.Combine(root,folder); Directory.CreateDirectory(dir); return Path.Combine(dir,name+extension);
  }
  void ReadDomain(MemoryDomain domain,byte[] data) {
   using(domain.EnterExit()) {
    if(domain is MemoryDomainIntPtrMonitor m) Marshal.Copy(m.Data,data,0,data.Length);
    else if(domain is MemoryDomainIntPtr p) Marshal.Copy(p.Data,data,0,data.Length);
    else for(int i=0;i<data.Length;i++) data[i]=domain.PeekByte(i);
   }
  }
  static object Field(object o,string name)=>o.GetType().GetField(name,BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic)?.GetValue(o);
  new void Capture(bool force=false) {
   if(closed || !(Emulator is PCEngine pc) || pc.Type!=NecSystemType.TurboGrafx)return;
   if(!free.TryDequeue(out var work)){if(!force||!captures.TryDequeue(out work)){skipped++;return;}skipped++;}
   var watch=Stopwatch.StartNew();
   try {
    work.Blocks.Clear();work.MemoryLength=0;
    raster=PceRasterObserver.Get(pc.VDC1);raster.Enabled=rasterEnabled;
    bool valid=raster.Valid;
    if(valid){if(raster.Generation!=lastRenderGeneration){lastRenderGeneration=raster.Generation;lastRenderFrame=Emulator.Frame;}else if(Emulator.Frame!=lastRenderFrame)valid=false;}
    var video=Emulator.AsVideoProvider();int w=video.BufferWidth,h=video.BufferHeight,n=w*h;
    if(w<1||w>1024||h<1||h>512)throw new InvalidOperationException("Invalid video dimensions");
    work.Width=w;work.Height=h;work.Valid=valid;work.Reason=valid?null:raster.Reason??"No new complete render";work.Generation=raster.Generation;
    work.Prepare(n);Array.Copy(video.GetVideoBuffer(),work.Video,n);
    if(valid){Array.Copy(raster.Background,work.Background,n);Array.Copy(raster.Sprites,work.Sprites,n);Array.Copy(raster.Source,work.Source,n);Array.Copy(raster.SpriteId,work.SpriteId,n);Array.Copy(raster.PaletteIndex,work.PaletteIndex,n);}
    var domains=new List<object>();
    foreach(var d in MemoryDomains.Where(d=>d.Size>0&&d.Size<=262144&&new[]{"Main Memory","VRAM1","VCEPalette","Battery RAM","Cart Battery RAM"}.Contains(d.Name))){
     if(!work.Memory.TryGetValue(d.Name,out var bytes)||bytes.Length!=d.Size)work.Memory[d.Name]=bytes=new byte[d.Size];
     ReadDomain(d,bytes);domains.Add(new {name=d.Name,size=bytes.Length,offset=work.MemoryLength,endian=d.EndianType.ToString(),wordSize=d.WordSize,unit="byte",sampling="completed-frame boundary"});work.Blocks.Add(bytes);work.MemoryLength+=bytes.Length;
    }
    work.Sat=(ushort[])pc.VDC1.SpriteAttributeTable.Clone();work.Palette=(int[])pc.VCE.Palette.Clone();work.Pattern=(byte[])pc.VDC1.PatternBuffer.Clone();work.Vram=(ushort[])pc.VDC1.VRAM.Clone();work.BatWidth=pc.VDC1.BatWidth;work.BatHeight=pc.VDC1.BatHeight;work.TopLine=pc.Settings.TopLine;work.ViewStartLine=pc.VDC1.ViewStartLine;
    // Only copied backing data is inspected. Never call either System Bus domain.
    var cpu=Field(pc,"Cpu");var mpr=(byte[])Field(cpu,"MPR");
    foreach(var entry in new[]{new {name="SATB",words=work.Sat},new {name="VDC Registers",words=pc.VDC1.Registers}}){var data=new byte[entry.words.Length*2];for(int i=0;i<entry.words.Length;i++){data[i*2]=(byte)entry.words[i];data[i*2+1]=(byte)(entry.words[i]>>8);}domains.Add(new {name=entry.name,size=data.Length,offset=work.MemoryLength,endian="Little",wordSize=2,unit="byte",sampling="completed-frame boundary"});work.Blocks.Add(data);work.MemoryLength+=data.Length;}
    string id=session+"-"+(++sequence);stepLastSnapshot=id;bool movie=_apiContainer.Movie.IsLoaded();
    work.Header=new Dictionary<string,object>{
     ["type"]="frame",["schema"]=1,["id"]=id,["session"]=session,["sequence"]=sequence,["frame"]=Emulator.Frame,
     ["rom"]=new {name=Game.Name,hash=Game.Hash},["core"]=Emulator.GetType().FullName,["version"]="2.11.1",["deterministic"]=Emulator.DeterministicEmulation,["mode"]="standard HuCard",
     ["paused"]=_apiContainer.EmuClient.IsPaused(),["lag"]=Emulator.AsInputPollable().IsLagFrame,
     ["movie"]=new {loaded=movie,mode=_apiContainer.Movie.Mode(),filename=movie?_apiContainer.Movie.Filename():"",length=movie?_apiContainer.Movie.Length():0,timelineFrame=movie&&Emulator.Frame<=_apiContainer.Movie.Length()?(int?)Emulator.Frame:null,readOnly=_apiContainer.Movie.GetReadOnly(),rerecords=movie?_apiContainer.Movie.GetRerecordCount():0,startsFromCheckpoint=movie&&_apiContainer.Movie.StartsFromSavestate()},
     ["playback"]=new {speedPercent=Config.SpeedPercent},["identity"]=new {sync=SyncIdentity(),native=nativeIdentity},
     ["execution"]=new {pendingStep=steps>0,requestedFrames=stepRequested,completedFrames=steps>0?Emulator.Frame-stepStart:0},
     ["inputs"]=_apiContainer.Joypad.GetWithMovie(),["buttons"]=Emulator.ControllerDefinition.BoolButtons.ToArray(),["domains"]=domains,
     ["ppu"]=new {registers=pc.VDC1.Registers.ToArray(),mpr=mpr?.Select(b=>(int)b).ToArray(),cpu=pc.GetCpuFlagsAndRegisters().ToDictionary(p=>p.Key,p=>p.Value.Value),cycles=pc.TotalExecutedCycles},
     ["geometry"]=new {width=w,height=h,requestedWidth=pc.VDC1.RequestedFrameWidth,requestedHeight=pc.VDC1.RequestedFrameHeight,topLine=pc.Settings.TopLine,bottomLine=pc.Settings.BottomLine,viewStartLine=pc.VDC1.ViewStartLine,pixelClockControl=pc.VCE.CR,conversion="native framebuffer; no browser resampling in evidence",multiResHack=pc.VDC1.MultiResHack,spriteLimitSetting=pc.Settings.SpriteLimit,effectiveSpriteLimit=pc.VDC1.PerformSpriteLimit},
     ["timing"]=new {numerator=video.VsyncNumerator,denominator=video.VsyncDenominator,fps=(double)video.VsyncNumerator/video.VsyncDenominator,region="NTSC (upstream nominal video cadence)",scanlines=pc.VCE.NumberOfScanlines,masterClockHz=21477270,cyclesPerScanline=455,clockDerivedCadence=21477270.0/(1365*pc.VCE.NumberOfScanlines)},
     ["capabilities"]=new {rasterLayers=valid,rasterSamples=valid,pixelProvenance=false,gameHitboxes=false,movies=true,frameStep=true,checkpoints=true},
     ["captureEvery"]=every,["capture_ms"]=watch.Elapsed.TotalMilliseconds,["skipped"]=skipped
    };
    captures.Enqueue(work);work=null;ready.Set();lastCapture=clock.ElapsedMilliseconds;
    if(clock.ElapsedMilliseconds-lastStatus>=500){lastStatus=clock.ElapsedMilliseconds;status.Text=$"{Game.Name} · PCEHawk / standard HuCard\nProducer: {(transportConnected?"connected":"disconnected")} · Capture: {(valid?"native / valid":raster.Reason)}\nFrame {Emulator.Frame} · {_apiContainer.Movie.Mode()} · copy {watch.Elapsed.TotalMilliseconds:F1} ms\nInspector: http://127.0.0.1:{Environment.GetEnvironmentVariable("REA_TG16_HTTP_PORT")??"8920"}";}
   }catch(Exception e){status.Text="Capture error: "+e.Message;File.WriteAllText(Path.Combine(root,"session/capture-error.txt"),e.ToString());}
   finally{if(work!=null)free.Enqueue(work);}
  }
  long lastStatus;
  void Transport() {
   int port=int.TryParse(Environment.GetEnvironmentVariable("REA_TG16_STREAM_PORT"),out var p)?p:8921;
   while(!closed) {
    try {
     using(var client=new TcpClient()) {
      client.NoDelay=true; client.Connect("127.0.0.1",port);transportConnected=true;
      using(var stream=client.GetStream()) {
       var hello=Packet(new {type="hello",token=Environment.GetEnvironmentVariable("REA_TG16_NATIVE_TOKEN")});stream.Write(hello,0,hello.Length);
       var reader=Task.Run(()=> {
        try {using(var lines=new StreamReader(stream,Encoding.UTF8,false,4096,true)) {
         while(!closed) { string line=lines.ReadLine(); if(line==null)break; if(line.Length>65536||commands.Count>=16)break; commands.Enqueue(JObject.Parse(line)); }
        }} catch {} finally {try{client.Close();}catch{}}
       });
       while(!closed && !reader.IsCompleted) {
        while(replies.TryDequeue(out var reply)) stream.Write(reply,0,reply.Length);
        if(captures.TryDequeue(out var work))try {var packet=work.Encode();stream.Write(packet,0,work.PacketLength);}
        catch(Exception e){File.WriteAllText(Path.Combine(root,"transport-error.txt"),e.ToString());throw;}
        finally {free.Enqueue(work);}
        else ready.WaitOne(100);
       }
      }
     }
    } catch { if(!closed) ready.WaitOne(1000); } finally {transportConnected=false;}
   }
  }
 }
}
