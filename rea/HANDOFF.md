# TURBO REAPER handoff — 5 November 2026

Historical migration handoff, preserved from the previous worker. The visible chat resumed this exact work; current behavior and results are documented in README.md, SPEC.md and VALIDATION.md. Statements below describe the migration boundary, not the current delivered implementation.

Implementation is stopped for migration into a visible chat. No parallel writer remains. Resume in `C:/Users/Chris/Desktop/AI Code/REA Emulators/tg16/` and preserve existing work.

## Task and authorization

Build **TURBO REAPER - BizHawk**, a PC Engine/TurboGrafx-16 HuCard REA emulator. Read `../../docs/agent-briefs/TURBOGRAFX16-AGENT.md` and `SHARED-REQUIREMENTS.md` plus workspace instructions. Existing `snes/`, `blastem/`, `fceux/` and the sibling `neogeo/` project are read-only references. This project owns only `tg16/`. The user authorized a dedicated GitHub repo; source/docs commits and pushes to it are allowed, with no ROMs/BIOS/session/private data, no release creation and no visibility changes. Suggested configurable ports: HTTP 8920 and native stream/control 8921 (optional separate control 8922).

## Git state

- Private repository: <https://github.com/Bertzerker/TURBO-REAPER-BizHawk>
- Origin: `https://github.com/Bertzerker/TURBO-REAPER-BizHawk.git`
- Branch: `master`, tracking `origin/master`.
- Pushed bootstrap commit: `eac9485377a29d737e37ee5bbf298b4cd3e6e783` — `Bootstrap TURBO REAPER BizHawk integration scope and isolated build`.
- Last status before this file: `?? rea/native/` only. This HANDOFF.md is also new/uncommitted. No existing tracked source was modified after the bootstrap.
- GitHub CLI authentication works outside sandbox; use approved `require_escalated` remote operations. Do not display credentials.

Bootstrap tracks `.gitignore`, root README, LICENSE.BizHawk, INTEGRATION-NOTES.md, rea/LICENSE, rea/CORE-SELECTION.md and rea/SPEC.md. Those docs correctly say implementation is incomplete.

## Selected core and approach

Selected **BizHawk 2.11.1 / PCEHawk**, using its directly instrumentable managed VDC scanline renderer and existing full-state/BK2/TAStudio services. This is a scanline renderer, not Mednafen's finer timing model; document that limitation. Initial scope is standard HuCards; CD and SuperGrafx are unvalidated/unavailable REA modes.

Inspected upstream PCEHawk `VDC.cs`, `VDC.Render.cs`, `PCEngine.cs`, memory domain, state, settings and frame-advance sources in the read-only SNES source archive. `IPceGpuView` offers VRAM/cache diagnostics, not captured raster inputs. No actual emulator was launched or diagnostic ROM created.

Current intended instrumentation uses guarded Mono.Cecil insertion of observer calls into an isolated copy of `BizHawk.Emulation.Cores.dll`, keeping emulated renderer logic intact and observer storage in an external ConditionalWeakTable so it does not enter savestates. Hooks: VDC ExecFrame begin/complete; after normal background render; four admitted sprite-pixel loops before BG priority composition. This approach and all new hook code still require build, native correctness and observation-on/off verification.

## Uncommitted source files

- `rea/native/PceRasterObserver.cs` (3527 bytes): net48-targeted observer helper referencing PCEHawk. Copies the actual post-BG framebuffer row before sprites, records admitted sprite samples/object index/palette index, and records source classification. Reflection caches the VDC's private core/priority arrays. NOT COMPILED OR TESTED.
- `rea/native/PatchCore.cs` (4106 bytes): exact SHA-guarded Mono.Cecil injector. Uses original embedded PDB local names/index guards and widens short branches after injection. NOT COMPILED OR TESTED in this version.
- `rea/native/PatchCore.csproj` (338 bytes): net10 console project referencing pinned local Mono.Cecil. IMPORTANT NEXT FIX: default Compile includes `PceRasterObserver.cs`, which is intended for a separate net48 helper DLL; exclude that file from the patcher project or explicitly include only PatchCore.cs. Otherwise the patcher project lacks BizHawk references and will fail.

No Build.ps1, Start-REA.ps1, producer bridge, server, production UI, tests, diagnostic source, PARITY.md or VALIDATION.md has been implemented yet. Do not claim those features are delivered.

## Ignored local dependencies and runtime

- `upstream/BizHawk-2.11.1-win-x64.zip`: copied pristine release archive from the read-only SNES archive, SHA256 `DD7CBD5E205B09C5BCE6AFABC4F8AA525ACC0BBEB9753B198A8DB3FE6A5E5717`.
- `emulator/`: freshly extracted pristine release. It has NOT been patched or launched.
- Original core SHA256 required by injector: `444BC157418E9B5DF5D07E987FC7AD1D2D1C6993676F5B864368027CB4F054D5`.
- `rea/native/mono.cecil.0.11.6.zip` and extracted `rea/native/cecil/`: pinned official NuGet dependency, SHA256 `D2A23832AAA948BA9A01ACC42B5726E34C5F995958F1B30D45C0E7C70B3A72D5`; MIT notice is within package.
- `rea/native/bin/` and `obj/`: outputs of an earlier temporary IL-dump version of PatchCore, NOT the current injector.
- Empty working directories exist under `rea/test/`, `rea/test-output/`, `rea/public/`.

## Commands actually executed

Successful: `git init tg16`; configured origin; staged reviewed bootstrap docs; committed and pushed with `git -C tg16 push -u origin HEAD`. No user ROM/firmware or runtime binaries were staged.

Successful dependency acquisition outside sandbox:

```powershell
Invoke-WebRequest https://api.nuget.org/v3-flatcontainer/mono.cecil/0.11.6/mono.cecil.0.11.6.nupkg -OutFile tg16/rea/native/mono.cecil.0.11.6.zip
Expand-Archive tg16/rea/native/mono.cecil.0.11.6.zip tg16/rea/native/cecil -Force
```

The same download inside sandbox failed DNS (`No such host is known`). Escalation resolved it.

Successful command with an earlier temporary IL-dumper source:

```powershell
dotnet run --project tg16/rea/native/PatchCore.csproj -- snes/emulator/dll/BizHawk.Emulation.Cores.dll
```

It confirmed embedded PDB locals in `RenderSpritesScanline`: i=2, paletteBase=9, priority=10; xs/pixel pairs (15,16), (17,18), (19,20), (21,22). Output was inspection only, no writes to SNES. That temporary source was replaced by the untested injector above; the command is no longer the current injector's CLI.

Successful pristine extraction:

```powershell
Copy-Item snes/BizHawk-2.11.1-win-x64.zip tg16/upstream/BizHawk-2.11.1-win-x64.zip
Expand-Archive tg16/upstream/BizHawk-2.11.1-win-x64.zip tg16/emulator -Force
```

One apply_patch failed because it attempted delete+add for the same PatchCore.cs path; it applied nothing. The subsequent update/add patch succeeded. There are no native, integration or browser test results yet.

## Processes and sessions

No emulator/server/browser was started by this agent. All dotnet/download/extraction/git commands completed. A recursive filesystem search owned exec session 55199; Ctrl+C was sent and it returned exit code 1. It needs no adoption. Do not touch existing user EmuHawk/Node processes. There are no live process handles to inherit from this agent.

## Immediate next actions

1. Fix patcher Compile items as noted, then create Build.ps1 that verifies/downloads pristine archives, compiles PceRasterObserver.cs as `TURBO.REA.Observer.dll` against net48/BizHawk DLLs, and runs PatchCore with ORIGINAL core, helper DLL and separate output core arguments. Verify it never patches an already-modified assembly or any sibling installation.
2. Test hook structure carefully: helper circular assembly identity references, branches/stack correctness, geometry changes, skipped rendering, reset/state invalidation, partial-frame initialization and sprite presence/priority semantics. A state/output equality test with hooks enabled/disabled is essential.
3. Adapt the MIT SNES bridge/control/evidence architecture to PCE-specific memory/domain/palette/SATB/mapping and atlas data. Do not retain SNES layer labels/raw native sample assumptions. Preserve BK2/state/native service semantics and classify unsupported modes.
4. Generate an original HuCard diagnostic with RAM/input checks, BG/sprite overlap and scanline palette/scroll changes; build/run the isolated native producer and prove capture/step/state restore before further claims.
5. Implement common production workbench/API, leases, saved review, revisions/drafts, exports, tests and reports per full brief. Keep evidence/UI data distinct from restorable machine state. Complete actual native/browser validation and document exact outstanding limits.
6. Commit/push only reviewed source/docs/original diagnostics; runtime archives, extracted binaries, dependency cache, user assets and test/session evidence remain ignored.

No external asset or build blocker has been established yet. Installed dotnet SDKs 10.0.202/10.0.301 and net48 reference assemblies exist. Use verified Python `C:/Users/Chris/AppData/Local/Python/bin/python.exe`. Browser work must use Codex in-app browser first. Do not spawn extra agents without explicit user instruction.
