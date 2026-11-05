# SPDX-License-Identifier: MIT
param([string]$Archive,[switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7 -or !$IsWindows) { throw 'Run Setup.ps1 on Windows with PowerShell 7 or later.' }
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$dist = Join-Path $root 'dist'
$manifestPath = Join-Path $dist 'manifest.json'
if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Run Setup.ps1 from the extracted Windows release ZIP. Use rea/Build.ps1 from a source checkout.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
$layout = [ordered]@{
 'TurboPatchCore.exe' = $null
 'Mono.Cecil.dll' = $null
 'REA.Turbo.dll' = 'ExternalTools/REA.Turbo.dll'
 'TURBO.REA.Observer.dll' = 'dll/TURBO.REA.Observer.dll'
 'TurboNativeHarness.exe' = 'dll/TurboNativeHarness.exe'
 'TurboNativeHarness.exe.config' = 'dll/TurboNativeHarness.exe.config'
 'TurboStockLoader.exe' = 'dll/TurboStockLoader.exe'
 'TurboStockLoader.exe.config' = 'dll/TurboStockLoader.exe.config'
}
function Require-Hash([string]$File,[string]$Hash) {
 if ($Hash -notmatch '^[0-9a-fA-F]{64}$' -or !(Test-Path -LiteralPath $File -PathType Leaf) -or (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Hash) {
  throw "Missing or unexpected bytes: $File"
 }
}
if ($manifest.schema -ne 1 -or $manifest.commit -notmatch '^[0-9a-f]{40}$' -or $manifest.assets.Count -ne $layout.Count) { throw 'Invalid release manifest.' }
foreach ($file in $layout.Keys) { Require-Hash (Join-Path $dist $file) $manifest.assets[$file] }
$releaseHash = 'DD7CBD5E205B09C5BCE6AFABC4F8AA525ACC0BBEB9753B198A8DB3FE6A5E5717'
if ($Archive) { Require-Hash $Archive $releaseHash; $Archive = (Resolve-Path -LiteralPath $Archive).Path }
if ($VerifyOnly) { Write-Output "Verified TURBO REAPER assets for $($manifest.tag) at $($manifest.commit)."; return }

$emulator = Join-Path $root 'emulator'
if (Test-Path -LiteralPath $emulator) { throw 'The emulator destination already exists. Extract the release into a fresh directory for setup.' }
$upstream = Join-Path $root 'upstream'
New-Item -ItemType Directory -Path $upstream -Force | Out-Null
$work = (New-Item -ItemType Directory -Path (Join-Path $upstream ('setup-' + [guid]::NewGuid().ToString('N')))).FullName
if ((Split-Path $work -Parent) -ne $upstream) { throw 'Unexpected setup staging location.' }
try {
 if (!$Archive) {
  $Archive = Join-Path $upstream 'BizHawk-2.11.1-win-x64.zip'
  if (!(Test-Path -LiteralPath $Archive)) {
   $download = Join-Path $work 'BizHawk-2.11.1-win-x64.zip'
   Invoke-WebRequest 'https://github.com/TASEmulators/BizHawk/releases/download/2.11.1/BizHawk-2.11.1-win-x64.zip' -OutFile $download
   Require-Hash $download $releaseHash
   Move-Item -LiteralPath $download -Destination $Archive
  }
  Require-Hash $Archive $releaseHash
 }
 $fresh = Join-Path $work 'emulator'
 $pristine = Join-Path $upstream 'pristine'
 $stockCore = 'dll/BizHawk.Emulation.Cores.dll'
 $stockHash = '444BC157418E9B5DF5D07E987FC7AD1D2D1C6993676F5B864368027CB4F054D5'
 Expand-Archive -LiteralPath $Archive -DestinationPath $fresh
 Require-Hash (Join-Path $fresh $stockCore) $stockHash
 if (!(Test-Path -LiteralPath $pristine)) {
  $stockCopy = Join-Path $work 'pristine'
  Copy-Item -LiteralPath $fresh -Destination $stockCopy -Recurse
  Move-Item -LiteralPath $stockCopy -Destination $pristine
 }
 Require-Hash (Join-Path $pristine $stockCore) $stockHash
 foreach ($file in $layout.Keys) {
  if ($layout[$file]) { Copy-Item -LiteralPath (Join-Path $dist $file) -Destination (Join-Path $fresh $layout[$file]) }
 }
 $patched = Join-Path $work 'BizHawk.Emulation.Cores.dll'
 & (Join-Path $dist 'TurboPatchCore.exe') (Join-Path $pristine $stockCore) (Join-Path $fresh 'dll/TURBO.REA.Observer.dll') $patched
 if ($LASTEXITCODE -ne 0) { throw 'PCEHawk patching failed.' }
 Require-Hash $patched $manifest.patchedCoreSha256
 Move-Item -LiteralPath $patched -Destination (Join-Path $fresh $stockCore) -Force
 Move-Item -LiteralPath $fresh -Destination $emulator
} finally {
 $resolved = (Resolve-Path -LiteralPath $work).Path
 if ((Split-Path $resolved -Parent) -eq $upstream) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
Write-Output 'TURBO REAPER is installed locally. Run ./rea/Start-REA.ps1 -Rom "C:/path/to/game.pce" -Wait'
