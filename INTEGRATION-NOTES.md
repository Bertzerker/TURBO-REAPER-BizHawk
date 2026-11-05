# Coordinator integration notes

Product: **TURBO REAPER - BizHawk**. Repository: `Bertzerker/TURBO-REAPER-BizHawk` (private).

Owned tree: `tg16/`. Existing console installations and shared docs stayed read-only. The managed observer, bridge, loopback server and production workbench now run. Native diagnostics cover raster palettes, priority/transparency, input, compatible persistent state, BK2 replay/cold restart, 256/320/512 geometry, sprite limits and observer integrity. Reports and screenshots remain local under ignored `rea/test-output/`.

Commands: `./rea/Build.ps1`; `./rea/Start-REA.ps1 -Diagnostic -Mute`; `node --test ./rea/test/workbench.test.mjs`; `node ./rea/test/verify-native.mjs`; after real restart `node ./rea/test/verify-cold.mjs`; `node ./rea/test/measure-native.mjs`. HTTP/native defaults 8920/8921. See `rea/README.md`, `SPEC.md`, `PARITY.md`, `VALIDATION.md` and `DEPENDENCIES.md`.

The PCEHawk scanline/cache timing limit remains explicit. A guarded host framebuffer-capacity fix handles the stock renderer's 512-pixel overrun. SuperGrafx/CD/firmware/controller extensions, bounded REA CPU trace/watch and exact fetch/CPU-DMA provenance remain unavailable. User-supplied assets and derived private game evidence stay ignored and are excluded from Git/default exports.

Root integration suggestion after validation: add the console's run/build/specification links and port 8920 to the project overview. Do not route Neo Geo Pocket through this project; this assignment is PC Engine HuCards.
