# SPDX-License-Identifier: MIT
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$emulator = Join-Path $root 'emulator'
$owned = @(Get-Process EmuHawk -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($emulator, [StringComparison]::OrdinalIgnoreCase) })
if ($owned.Count) { throw 'Close this TURBO REAPER installation before rebuilding it.' }
function Require-Hash($path, $hash) {
 if (!(Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $hash) { throw "Missing or unexpected dependency: $path" }
}
$archive = Join-Path $root 'upstream/BizHawk-2.11.1-win-x64.zip'
if (!(Test-Path $archive)) {
 New-Item -ItemType Directory -Force (Split-Path $archive) | Out-Null
 Invoke-WebRequest 'https://github.com/TASEmulators/BizHawk/releases/download/2.11.1/BizHawk-2.11.1-win-x64.zip' -OutFile $archive
}
Require-Hash $archive 'DD7CBD5E205B09C5BCE6AFABC4F8AA525ACC0BBEB9753B198A8DB3FE6A5E5717'
if (!(Test-Path "$emulator/EmuHawk.exe")) { Expand-Archive -LiteralPath $archive -DestinationPath $emulator }
$original = Join-Path $root 'upstream/pristine'
if (!(Test-Path "$original/dll/BizHawk.Emulation.Cores.dll")) { Expand-Archive -LiteralPath $archive -DestinationPath $original }
Require-Hash "$original/dll/BizHawk.Emulation.Cores.dll" '444BC157418E9B5DF5D07E987FC7AD1D2D1C6993676F5B864368027CB4F054D5'
$cecil = Join-Path $PSScriptRoot 'native/mono.cecil.0.11.6.zip'
if (!(Test-Path $cecil)) { Invoke-WebRequest 'https://api.nuget.org/v3-flatcontainer/mono.cecil/0.11.6/mono.cecil.0.11.6.nupkg' -OutFile $cecil }
Require-Hash $cecil 'D2A23832AAA948BA9A01ACC42B5726E34C5F995958F1B30D45C0E7C70B3A72D5'
if (!(Test-Path "$PSScriptRoot/native/cecil/lib/netstandard2.0/Mono.Cecil.dll")) { Expand-Archive -LiteralPath $cecil -DestinationPath "$PSScriptRoot/native/cecil" }
$sdk = (& dotnet --list-sdks | Select-Object -Last 1).Split(' ')[0]
$compiler = "C:/Program Files/dotnet/sdk/$sdk/Roslyn/bincore/csc.dll"
$framework = 'C:/Program Files (x86)/Reference Assemblies/Microsoft/Framework/.NETFramework/v4.8'
$refs = @('mscorlib','System','System.Core','System.Drawing','System.Windows.Forms') | ForEach-Object { "/reference:$framework/$_.dll" }
$refs += "/reference:$framework/Facades/netstandard.dll"
$refs += @('BizHawk.Client.Common','BizHawk.Common','BizHawk.Emulation.Common','BizHawk.Emulation.Cores','BizHawk.WinForms.Controls','BizHawk.Bizware.Graphics','Newtonsoft.Json') | ForEach-Object { "/reference:$original/dll/$_.dll" }
$refs += "/reference:$original/EmuHawk.exe"
$portable = "$PSScriptRoot/native/bin/portable"
New-Item -ItemType Directory -Force -Path $portable | Out-Null
$cecilRuntime = "$PSScriptRoot/native/cecil/lib/net40/Mono.Cecil.dll"
Copy-Item -LiteralPath $cecilRuntime -Destination $portable -Force
& dotnet $compiler /nologo /target:exe /langversion:latest /optimize+ "/out:$portable/TurboPatchCore.exe" "/reference:$framework/mscorlib.dll" "/reference:$framework/System.dll" "/reference:$framework/System.Core.dll" "/reference:$cecilRuntime" "$PSScriptRoot/native/PatchCore.cs"
if ($LASTEXITCODE -ne 0) { throw 'Guarded patcher compilation failed' }
& dotnet $compiler /nologo /target:library /langversion:latest /optimize+ "/out:$emulator/dll/TURBO.REA.Observer.dll" @refs "$PSScriptRoot/native/PceRasterObserver.cs"
if ($LASTEXITCODE -ne 0) { throw 'Observer compilation failed' }
& "$portable/TurboPatchCore.exe" "$original/dll/BizHawk.Emulation.Cores.dll" "$emulator/dll/TURBO.REA.Observer.dll" "$emulator/dll/BizHawk.Emulation.Cores.dll"
if ($LASTEXITCODE -ne 0) { throw 'Guarded core patch failed' }
if (Test-Path "$PSScriptRoot/REATurbo.cs") {
 $refs += "/reference:$emulator/dll/TURBO.REA.Observer.dll"
 $sources = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cs' | ForEach-Object FullName)
 & dotnet $compiler /nologo /target:library /langversion:latest /optimize+ "/out:$emulator/ExternalTools/REA.Turbo.dll" @refs @sources
 if ($LASTEXITCODE -ne 0) { throw 'TURBO REAPER tool compilation failed' }
}
Write-Output 'TURBO REAPER isolated build complete.'
$testRefs = $refs + "/reference:$emulator/dll/TURBO.REA.Observer.dll"
& dotnet $compiler /nologo /target:exe /langversion:latest /optimize+ "/out:$emulator/dll/TurboNativeHarness.exe" @testRefs "$PSScriptRoot/native/NativeHarness.cs"
if ($LASTEXITCODE -ne 0) { throw 'Native integrity harness compilation failed' }
Copy-Item -LiteralPath "$emulator/EmuHawk.exe.config" -Destination "$emulator/dll/TurboNativeHarness.exe.config" -Force
& dotnet $compiler /nologo /target:exe /langversion:latest /optimize+ "/out:$emulator/dll/TurboStockLoader.exe" @testRefs "$PSScriptRoot/native/StockLoader.cs"
if ($LASTEXITCODE -ne 0) { throw 'Read-only stock validation loader compilation failed' }
Copy-Item -LiteralPath "$emulator/EmuHawk.exe.config" -Destination "$emulator/dll/TurboStockLoader.exe.config" -Force
