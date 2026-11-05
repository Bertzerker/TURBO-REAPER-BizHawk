// SPDX-License-Identifier: MIT
// Observes the selected PCEHawk renderer; no second render and no bus reads.
using System;
using System.Reflection;
using System.Runtime.CompilerServices;
using BizHawk.Emulation.Cores.PCEngine;
namespace TurboReaper {
 public sealed class RasterCapture {
  public bool Valid,Enabled=true; public string Reason="No complete render"; public long Generation;
  public int Width,Height,Rows; public int[] Background=new int[0],Sprites=new int[0],Source=new int[0];
  public short[] SpriteId=new short[0]; public ushort[] PaletteIndex=new ushort[0];
  internal PCEngine Core; internal byte[] Priority; internal int Frame;internal bool GeometryChanged;
  public void Invalidate(){Valid=false;Reason="State/ROM changed; render a fresh complete frame";}
 }
 public static class PceRasterObserver {
  static readonly ConditionalWeakTable<VDC,RasterCapture> Frames=new ConditionalWeakTable<VDC,RasterCapture>();
  static readonly FieldInfo CoreField=typeof(VDC).GetField("pce",BindingFlags.NonPublic|BindingFlags.Instance);
  static readonly FieldInfo PriorityField=typeof(VDC).GetField("PriorityBuffer",BindingFlags.NonPublic|BindingFlags.Instance);
  public static RasterCapture Get(VDC vdc)=>Frames.GetValue(vdc,v=>new RasterCapture{Core=(PCEngine)CoreField.GetValue(v),Priority=(byte[])PriorityField.GetValue(v)});
  public static void Begin(VDC vdc) {
   var f=Get(vdc);f.Valid=false;f.Rows=0;f.GeometryChanged=false;f.Frame=f.Core.Frame;f.Reason="Render in progress";
   if(!f.Enabled){f.Reason="Observer disabled";return;}
   int w=vdc.BufferWidth,h=vdc.BufferHeight;
   if(w<1||w>1024||h<1||h>512){f.Reason="Unsupported output dimensions";return;}
   f.Width=w;f.Height=h;int n=w*h;
   if(f.Background.Length!=n){f.Background=new int[n];f.Sprites=new int[n];f.Source=new int[n];f.SpriteId=new short[n];f.PaletteIndex=new ushort[n];}
   Array.Clear(f.Background,0,n);Array.Clear(f.Sprites,0,n);Array.Clear(f.Source,0,n);Array.Clear(f.PaletteIndex,0,n);
   for(int i=0;i<n;i++)f.SpriteId[i]=-1;
  }
  public static void Background(VDC vdc) {
   var f=Get(vdc);if(!f.Enabled)return;if(f.Width!=vdc.BufferWidth||f.Height!=vdc.BufferHeight){f.GeometryChanged=true;return;}
   int y=vdc.ActiveLine+vdc.ViewStartLine-f.Core.Settings.TopLine;
   if(y<0||y>=f.Height)return;
   int start=y*f.Width,n=Math.Min(vdc.RequestedFrameWidth,f.Width);var output=vdc.GetVideoBuffer();
   if(start+n>output.Length)return;
   for(int x=0;x<n;x++){int i=start+x;bool present=vdc.BackgroundEnabled&&f.Core.Settings.ShowBG1&&f.Priority[x]!=0;f.Background[i]=present?output[i]|unchecked((int)0xff000000):0;f.Source[i]=present?unchecked((int)0xff92d6b2):unchecked((int)0xff334251);}
   f.Rows++;
  }
  public static void Sprite(VDC vdc,int x,int pixel,int paletteBase,bool priority,int sprite,bool show) {
   var f=Get(vdc);if(!f.Enabled||!show||f.Width!=vdc.BufferWidth||f.Height!=vdc.BufferHeight)return;
   int y=vdc.ActiveLine+vdc.ViewStartLine-f.Core.Settings.TopLine;if(x<0||x>=f.Width||y<0||y>=f.Height)return;
   int at=y*f.Width+x;f.Sprites[at]=f.Core.VCE.Palette[paletteBase+pixel]|unchecked((int)0xff000000);f.SpriteId[at]=(short)sprite;f.PaletteIndex[at]=(ushort)(paletteBase+pixel);
   if(priority||f.Priority[x]==0)f.Source[at]=unchecked((int)0xffe4be7c);
  }
  public static void Complete(VDC vdc) {
   var f=Get(vdc);if(!f.Enabled)return;
   if(f.GeometryChanged||f.Width!=vdc.BufferWidth||f.Height!=vdc.BufferHeight){f.Reason="Geometry changed during frame; wait for complete stable geometry";return;}
   f.Valid=f.Rows>0;f.Reason=f.Valid?null:"No visible scanline rendered";if(f.Valid)f.Generation++;
  }
 }
}
