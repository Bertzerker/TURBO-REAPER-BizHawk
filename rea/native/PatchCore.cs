// SPDX-License-Identifier: MIT
// Exact-build-guarded observer injection; the existing renderer logic is retained.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Mono.Cecil;
using Mono.Cecil.Cil;
if(args.Length!=3)throw new ArgumentException("PatchCore original-core observer-dll output-core");
const string Expected="444BC157418E9B5DF5D07E987FC7AD1D2D1C6993676F5B864368027CB4F054D5";
string Hash(string path){using var sha=SHA256.Create();using var stream=File.OpenRead(path);return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","");}
if(Hash(args[0])!=Expected)throw new InvalidDataException("Unrecognized BizHawk 2.11.1 core; refusing to patch");
var resolver=new DefaultAssemblyResolver();resolver.AddSearchDirectory(Path.GetDirectoryName(Path.GetFullPath(args[0])));resolver.AddSearchDirectory(Path.GetDirectoryName(Path.GetFullPath(args[1])));
using var asm=AssemblyDefinition.ReadAssembly(args[0],new ReaderParameters{AssemblyResolver=resolver,ReadSymbols=true});
using var observer=AssemblyDefinition.ReadAssembly(args[1]);var module=asm.MainModule;var type=module.GetType("BizHawk.Emulation.Cores.PCEngine.VDC");var hooks=observer.MainModule.GetType("TurboReaper.PceRasterObserver");
MethodReference Hook(string name)=>module.ImportReference(hooks.Methods.Single(m=>m.Name==name));
// Upstream changes FramePitch up to 512 but leaves a 320*262 allocation.
// Keep render logic unchanged; reserve enough host output storage for its admitted width.
var ctor=type.Methods.Single(m=>m.IsConstructor&&!m.IsStatic);
var fb=ctor.Body.Instructions.Single(i=>i.OpCode==OpCodes.Stfld&&i.Operand is FieldReference f&&f.Name=="FrameBuffer");
if(fb.Previous.OpCode!=OpCodes.Newarr||fb.Previous.Previous.OpCode!=OpCodes.Ldc_I4||(int)fb.Previous.Previous.Operand!=320*262)throw new InvalidDataException("Unexpected framebuffer allocation");
fb.Previous.Previous.Operand=512*262;
var exec=type.Methods.Single(m=>m.Name=="ExecFrame");var il=exec.Body.GetILProcessor();var first=exec.Body.Instructions[0];il.InsertBefore(first,il.Create(OpCodes.Ldarg_0));il.InsertBefore(first,il.Create(OpCodes.Call,Hook("Begin")));
foreach(var ret in exec.Body.Instructions.Where(i=>i.OpCode==OpCodes.Ret).ToArray()){il.InsertBefore(ret,il.Create(OpCodes.Ldarg_0));il.InsertBefore(ret,il.Create(OpCodes.Call,Hook("Complete")));}
var line=type.Methods.Single(m=>m.Name=="RenderScanLine");il=line.Body.GetILProcessor();var call=line.Body.Instructions.Single(i=>i.OpCode==OpCodes.Callvirt&&i.Operand is MethodReference m&&m.Name=="Invoke");var next=call.Next;il.InsertBefore(next,il.Create(OpCodes.Ldarg_0));il.InsertBefore(next,il.Create(OpCodes.Call,Hook("Background")));
var sprites=type.Methods.Single(m=>m.Name=="RenderSpritesScanline");var names=new Dictionary<int,string>();Walk(sprites.DebugInformation.Scope);void Walk(ScopeDebugInformation scope){foreach(var v in scope.Variables)names[v.Index]=v.Name;foreach(var s in scope.Scopes)Walk(s);}
foreach(var pair in new[]{(2,"i"),(8,"patternNo"),(9,"paletteBase"),(10,"priority"),(15,"xs"),(16,"pixel"),(17,"xs"),(18,"pixel"),(19,"xs"),(20,"pixel"),(21,"xs"),(22,"pixel")})if(!names.TryGetValue(pair.Item1,out var n)||n!=pair.Item2)throw new InvalidDataException("Unexpected renderer locals");
il=sprites.Body.GetILProcessor();int count=0;
foreach(var field in sprites.Body.Instructions.Where(i=>i.OpCode==OpCodes.Ldfld&&i.Operand is FieldReference f&&f.Name=="InterSpritePriorityBuffer").ToArray()){
 var x=field.Next;var one=x.Next;var store=one.Next;if(one.OpCode!=OpCodes.Ldc_I4_1||store.OpCode!=OpCodes.Stelem_I1)continue;
 if(x.Operand is not VariableDefinition xs||!new[]{15,17,19,21}.Contains(xs.Index))throw new InvalidDataException("Unexpected admitted sprite store");
 var at=store.Next;foreach(var i in new[]{il.Create(OpCodes.Ldarg_0),il.Create(OpCodes.Ldloc,xs),il.Create(OpCodes.Ldloc,sprites.Body.Variables[xs.Index+1]),il.Create(OpCodes.Ldloc,sprites.Body.Variables[9]),il.Create(OpCodes.Ldloc,sprites.Body.Variables[10]),il.Create(OpCodes.Ldloc,sprites.Body.Variables[2]),il.Create(OpCodes.Ldarg_1),il.Create(OpCodes.Ldloc,sprites.Body.Variables[8]),il.Create(OpCodes.Call,Hook("Sprite"))})il.InsertBefore(at,i);count++;
}
if(count!=4)throw new InvalidDataException($"Expected four sprite loop hooks; found {count}");
foreach(var m in new[]{exec,line,sprites})foreach(var i in m.Body.Instructions){if(i.OpCode.OperandType!=OperandType.ShortInlineBrTarget)continue;var full=i.OpCode.Name.Replace(".s","").Replace('.','_');var field=typeof(OpCodes).GetFields().Single(f=>f.Name.Equals(full,StringComparison.OrdinalIgnoreCase));i.OpCode=(OpCode)field.GetValue(null)!;}
asm.Write(args[2],new WriterParameters{WriteSymbols=false});
Console.WriteLine($"Patched exact core: Begin/Complete, one BG observer, {count} admitted-sprite observers. SHA256 {Hash(args[2])}");
