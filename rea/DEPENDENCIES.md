# Dependencies and licensing

Original integration, diagnostics and tests in `rea/` are MIT under [LICENSE](LICENSE). Adapted bridge, transport, workbench, comment, model and export modules retain MIT notices from SUPER REAPER / the workspace SNES integration. Its SNES native extension was not copied. No GPL implementation from NES/Genesis was copied.

| Component | Pin / acquisition | License / treatment |
| --- | --- | --- |
| BizHawk / PCEHawk | [2.11.1 release](https://github.com/TASEmulators/BizHawk/releases/tag/2.11.1), tag commit `bdddf4a` | [BizHawk notice](../LICENSE.BizHawk); original release component notices preserved. Integration MIT does not relicense upstream components. |
| Windows archive | Official release `BizHawk-2.11.1-win-x64.zip` | Ignored `upstream/`; SHA256 `DD7CBD5E205B09C5BCE6AFABC4F8AA525ACC0BBEB9753B198A8DB3FE6A5E5717` |
| Original core DLL | From that verified archive | SHA256 `444BC157418E9B5DF5D07E987FC7AD1D2D1C6993676F5B864368027CB4F054D5`; exact patch admission guard |
| Mono.Cecil | NuGet 0.11.6 | MIT; [license](native/Mono.Cecil-LICENSE.txt). The Windows package includes the net40 runtime DLL. Archive SHA256 `D2A23832AAA948BA9A01ACC42B5726E34C5F995958F1B30D45C0E7C70B3A72D5` |
| Newtonsoft.Json / framework references | BizHawk release / installed .NET Framework | Release/framework notices retained; binaries not checked in |
| marked 18.1.3, Mermaid 12.3.0, DOMPurify 3.4.17 | `ui-deps/package-lock.json`, bundled vendor module | MIT (marked/Mermaid), Apache-2.0 OR MPL-2.0 (DOMPurify); [vendor legal notices](public/vendor/note-renderer.mjs.LEGAL.txt), lockfile transitive inventory |
| esbuild 0.28.2 | Build-only npm pin | MIT; no npm runtime required by server |
| Node.js / Python / .NET SDK | Installed tools | Not redistributed |

Build.ps1 contains official acquisition URLs and verifies downloaded bytes. The Windows release ships the original bridge, observer, patcher, harness and Mono.Cecil runtime. Setup downloads the official BizHawk archive or takes a verified local copy and patches the core in the extracted installation. Source, the UI bundle and notices, and original diagnostic source are tracked. Installations, archives, dependency caches, user ROMs/firmware, sessions, annotations and test captures are ignored.

Browser tests additionally used isolated official Chromium snapshot `1735836`, reporting Chromium `159.0.8144.0`, under ignored `upstream/chromium/`. It is a test dependency, not a product runtime/profile change. The in-app browser was attempted first and exercised when available. Brave was not used.
