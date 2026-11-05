// SPDX-License-Identifier: MIT
// Reads the stock core in a separate AppDomain; writes no reference-installation files.
using System;
using System.IO;
using System.Reflection;
public class StockLoader:MarshalByRefObject {
 public void Run(string stock,string harness,string observer,string rom){
  var core=Assembly.Load("BizHawk.Emulation.Cores");
  if(!string.Equals(Path.GetFullPath(core.Location),Path.GetFullPath(Path.Combine(stock,"BizHawk.Emulation.Cores.dll")),StringComparison.OrdinalIgnoreCase))throw new Exception("Stock core binding mismatch");
  Assembly.LoadFrom(observer);
  var test=Assembly.LoadFrom(harness);
  test.EntryPoint.Invoke(null,new object[]{new[]{rom}});
 }
 static void Main(string[] args){
  var setup=new AppDomainSetup{ApplicationBase=Path.GetFullPath(args[0]),ConfigurationFile=Path.GetFullPath(args[1])};
  var domain=AppDomain.CreateDomain("TURBO read-only stock validation",null,setup);
  try{var worker=(StockLoader)domain.CreateInstanceFromAndUnwrap(typeof(StockLoader).Assembly.Location,typeof(StockLoader).FullName);worker.Run(setup.ApplicationBase,Path.GetFullPath(args[2]),Path.GetFullPath(args[3]),Path.GetFullPath(args[4]));}
  finally{AppDomain.Unload(domain);}
 }
}
