# TURBO REAPER - BizHawk

Run PowerShell 7 on Windows x64 with .NET SDK 10, .NET Framework 4.8 reference assemblies and Node.js (validated with 24.20.0). The build discovers the installed SDK/framework references and checks dependency hashes. Python is used for original diagnostics and offline verification; this workstation uses `C:/Users/Chris/AppData/Local/Python/bin/python.exe`.

```powershell
./rea/Build.ps1
./rea/Start-REA.ps1 -Diagnostic -Mute
# Or, after closing the previous instance:
./rea/Start-REA.ps1 -Rom 'C:/my games/game.pce' -Port 8920 -StreamPort 8921 -Paused
```

Open <http://127.0.0.1:8920/>. The launcher refuses another EmuHawk from this installation and leaves unrelated installations alone. Ports are never reclaimed by killing another process. HTTP defaults to 8920 and authenticated native duplex TCP to 8921; no separate 8922 listener is needed. `-Wait` stops the owned server when its emulator exits; without it the server remains useful for saved evidence. Close this installation before rebuilding. Initial archives are downloaded from official sources if absent; offline builds can place the exact archives listed in [DEPENDENCIES](DEPENDENCIES.md) at their named paths.

The original 8 KiB diagnostic boots paused and needs no firmware. Step ten frames to finish setup. Blue/red/green raster bands, two sprites and `TURBO-REA` in RAM are expected. Generate additional scenes with:

```powershell
& 'C:/Users/Chris/AppData/Local/Python/bin/python.exe' ./rea/make_test_rom.py --width 320
& 'C:/Users/Chris/AppData/Local/Python/bin/python.exe' ./rea/make_test_rom.py --width 512
& 'C:/Users/Chris/AppData/Local/Python/bin/python.exe' ./rea/make_test_rom.py --sprite-stress
```

In BizHawk use **Config → Controllers** for host bindings. Standard descriptors are P1 directions, Select, Run, B1 (I) and B2 (II). Execution experiments inject emulated input for 1–3600 frames and release unspecified buttons. Pause interrupts at a completed-frame boundary. Read-only BK2 playback owns input. Multitap/six-button topologies and CD/SuperGrafx are unavailable REA modes until separately implemented and tested.

Selecting a pixel pins one capture before lookup. Freeze does not pause the machine. Memory offsets are bytes: VRAM1 and VCEPalette use the core's Big-endian presentation of words; SATB and VDC Registers use explicit Little-endian word copies. Logical addresses require captured MPR context. The ROM route reads a single immutable authorized raw HuCard only when its SHA1 matches the capture, records SHA256, and excludes those bytes from default exports.

Movies use native BK2 files, beginning at power-on or a complete current-state checkpoint. The Movies drawer records, saves, stops, loads/restarts and inspects input rows. Movie frame N follows consumed input row N−1. TAStudio is a native window, not a browser timeline editor. General checkpoints are separate persistent `.State` files with compatibility and integrity sidecars; stop active movies before saving/restoring them.

Comments preserve the displayed native packet, boundary memory and immutable matching local movie bytes when available. Markdown, validated JSON and strict sanitized Mermaid previews use bundled local assets. Browser drafts recover after reload, discard is explicit, and stale saves return 409. Saved inspection never restores the machine. Exports include SHA256 manifests, graphics, memory, metadata, note revisions and archived BK2 bytes where available. State-started BK2 files contain their native starting state. General checkpoints are not silently exported as inspection evidence.

```powershell
node --test ./rea/test/workbench.test.mjs
# Against the original diagnostic only:
node ./rea/test/verify-native.mjs
# After a real close/relaunch:
node ./rea/test/verify-cold.mjs
node ./rea/test/measure-native.mjs
& 'C:/Users/Chris/AppData/Local/Python/bin/python.exe' ./rea/verify_bundle.py 'C:/path/to/evidence.zip'
```

API example:

```powershell
$base = 'http://127.0.0.1:8920'
$session = Invoke-RestMethod "$base/api/session"
$snapshot = Invoke-RestMethod "$base/api/snapshot"
Invoke-RestMethod "$base/api/pixel?snapshot=$($snapshot.id)&view=composite&x=64&y=48"
Invoke-RestMethod "$base/api/memory?snapshot=$($snapshot.id)&space=Main%20Memory&start=0&length=32"
Invoke-RestMethod "$base/api/logical?snapshot=$($snapshot.id)&address=8192"
Invoke-RestMethod "$base/api/control" -Method Post -ContentType application/json -Headers @{'X-REA-Token'=$session.token} -Body '{"action":"step","frames":30,"buttons":{"P1 B1":true}}'
```

See [SPEC](SPEC.md) for routes/bounds and [VALIDATION](VALIDATION.md) for evidence. A timeout has unknown outcome: requery state, never automatically retry. At frame zero, after state load, skipped rendering or geometry changes, advance a fresh complete frame. VRAM decoding cannot substitute for unavailable raster layers. Connection/capture errors are recorded in ignored `session/` logs. To rebuild preview assets, use `npm ci` and `node build.mjs` inside `rea/ui-deps/`; normal use needs no npm install.
