# SPDX-License-Identifier: MIT
param([switch]$Harness,[switch]$Native,[switch]$Sustained,[string]$Python='C:/Users/Chris/AppData/Local/Python/bin/python.exe')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
New-Item -ItemType Directory -Force "$PSScriptRoot/test-output" | Out-Null
& node --test --test-reporter=junit "$PSScriptRoot/test/workbench.test.mjs" | Set-Content "$PSScriptRoot/test-output/protocol-junit.xml"
if($LASTEXITCODE){throw 'Protocol/persistence tests failed; see test-output/protocol-junit.xml'}
if($Harness){
 if (!(Test-Path -LiteralPath $Python -PathType Leaf) -or $Python -match '[\\/]WindowsApps[\\/]') { throw 'Supply -Python with the full path to an installed Python 3 executable for the harness.' }
 foreach($width in @(256,320,512)){& $python "$PSScriptRoot/make_test_rom.py" --width $width;if($LASTEXITCODE){throw 'Diagnostic generation failed'}}
 & $python "$PSScriptRoot/make_test_rom.py" --sprite-stress
 foreach($mode in @('','-320','-512','-stress')){
  & "$root/emulator/dll/TurboNativeHarness.exe" "$PSScriptRoot/test-output/rea-diagnostic$mode.pce" | Set-Content "$PSScriptRoot/test-output/harness$mode.json"
  if($LASTEXITCODE){throw "Native harness failed for $mode"}
 }
 & "$root/emulator/dll/TurboStockLoader.exe" "$root/upstream/pristine/dll" "$root/emulator/EmuHawk.exe.config" "$root/emulator/dll/TurboNativeHarness.exe" "$root/emulator/dll/TURBO.REA.Observer.dll" "$PSScriptRoot/test-output/rea-diagnostic.pce" | Set-Content "$PSScriptRoot/test-output/harness-stock.json"
 if($LASTEXITCODE){throw 'Read-only stock core comparison failed'}
 & node "$PSScriptRoot/test/verify-harness.mjs"
 if($LASTEXITCODE){throw 'Native integrity report comparison failed'}
}
if($Native){
 & node "$PSScriptRoot/test/verify-native.mjs"
 if($LASTEXITCODE){throw 'Native frontend regression failed'}
 if($Sustained){& node "$PSScriptRoot/test/measure-native.mjs";if($LASTEXITCODE){throw 'Sustained native workload failed'}}
}elseif($Sustained){throw '-Sustained requires -Native and the original diagnostic installation running'}
Write-Output 'Requested TURBO REAPER checks passed. Reports are in rea/test-output/.'
