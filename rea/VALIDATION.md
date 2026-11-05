# Validation — 5 November 2026

Source build on Windows x64, .NET SDK 10, Framework 4.8, Node 24.20.0. Reports below are local ignored `rea/test-output/` artifacts. This document reports actual tests; protocol fixtures do not establish emulation correctness.

| Check | Observed result |
| --- | --- |
| Guarded build | Observer, external tool, core patch and native harness compiled. Exact original assembly/hash and four sprite-loop locals/stores admitted. |
| Original HuCard boot | Actual PCEHawk producer, RAM `TURBO-REA`, emulated input nibbles, native frame-step acknowledgments. |
| Raster palette/scroll | Blue/red/green displayed bands; end-of-frame copied palette holds blue and scroll is restored. Earlier captured bands cannot be satisfied by final-memory decoding. |
| Sprite composition | Front/behind BG sprites, opaque/transparent BG samples, per-admitted-pixel object/palette, source classification and final output checked. |
| Width / crop | 256×234, 320×234, 512×234 native diagnostics; 336×234 additionally observed in local game. Selection uses native coordinates, not fixed 256×224 scaling. |
| Sprite stress | Left clipping; max admitted object 15 for 16-sprite limit. Unknown-ROM upstream policy still forces that limit after disabling the checkbox. Hidden OBJ is valid blank evidence. |
| Observation integrity | Four actual-core 1800-frame runs compare entire serialized core state/output with observation on/off. Stock 256-wide core in an isolated read-only AppDomain produces the same state/output hashes. |
| Persistent checkpoints | Restore invalidates layers until fresh render; repeated input experiment matches full state/RAM/output. Wrong native identity rejected before state load. SHA256 sidecar validation implemented. |
| Bounded step interrupt | 3600-frame request interrupted after one completed frame; requested/completed counts returned. |
| BK2 replay | Original diagnostic recorded from exact native state. Two replays match full state; scripted override rejected during read-only playback. |
| Cold process restart | A real emulator/server restart replayed persisted BK2 to the same full state hash; original saved pixel evidence reopened independently of live machine. |
| Native TAStudio | Browser action opened `TAStudio - default.tasproj`; screenshot confirms PCE input columns. Native stepping returns valid captures. Timeline/branch editing itself was not exhaustively tested. |
| Service/persistence | Five tests cover fragmented/malformed packets, lossless stream, range units/edges, logical MPR resolution, old selection response rejection, producer auth, Host/Origin/token rejection, finite history/lease expiry, concurrent revisions, restart-safe saved review and offline ZIP hashes. |
| Production browser | In-app browser: live selection held frame 10900 while machine advanced past 11500, saved inspection and explicit return to live, rich Markdown/JSON/Mermaid, two-tab 409 conflict with intact draft, recovery in fresh page and explicit discard. |
| Responsive layout | Official standalone Chromium 159.0.8144.0 snapshots at exact 1440×900, 1024×768, 390×844 and 720×450; no page errors. Narrow layout focuses Composite and wraps controls. In-app requested viewport overrides did not reliably change effective CSS dimensions. |

`harness-summary.json`, `harness*.json`, `native-report.json`, `cold-report.json` and `protocol-junit.xml` hold machine-readable results. The stock comparison reads `upstream/pristine/dll` without adding or overwriting files there. An earlier combined command was rejected by automatic approval review because it proposed adding harness files to that baseline; it did not run. The separate read-only loader resolved that restriction.

The initial 512 diagnostic crashed the stock-sized framebuffer. The final patch expands only host output capacity to `512*262`; the 512 diagnostic then passed. This is a documented upstream fix, not a claim that unmodified upstream passes that mode. Diagnostic state/output equality against stock was performed at safe width 256.

Two sustained runs completed. An initial 180-second run observed 60.00 machine frames/s, copy p95 0.496 ms, encode p95 1.112 ms and no producer skips/invalid captures. Its active viewer sample reported 59.5 unique presentations/s, p95 interval 18.2 ms. The final build's 180.7-second workload observed 58.64 machine frames/s across the sampled interval, copy p95 0.691 ms, encode p95 0.869 ms, no producer skips, no invalid packets/captures and no delivery drops. The last rolling machine/capture samples were 60/s; no viewer was active in that run. Host activity and warm-up affect aggregate throughput. Source clock cadence, native emulation, captured delivery and viewer presentations remain separate measurements.

Final-run server history/query pools stayed at 16 entries; retained leases stayed bounded. RSS changed from about 149 MB to 225 MB between first/last samples, including V8 heap reservation and native packet buffers; this is not a leak-free certification. Native observer-only costs varied with host load: first direct-core pairs added about 0.16–0.35 ms/frame; later contended runs were slower. Full per-run p50/p95/elapsed values are retained rather than claiming zero overhead.

The 720×450 check exercises the effective layout size of a 1440×900 surface at 200% zoom. It is **not verified browser zoom**. In-app zoom/viewport behavior was inconsistent, so actual 200% browser zoom remains an explicit acceptance gap. Broader assistive-technology/contrast conformance and long multi-viewer sessions are not certified by these checks.

User-supplied **R-Type (USA)** was inspected locally: exactly one 524288-byte HuCard member was extracted into ignored `roms/user-supplied/`, preserving the original archive. Native capture/composition passed at 336×234. Two checkpoint/input replays matched full state and output, and two BK2 replays matched at three 30-frame boundaries. Those game captures, ROM bytes, movie/state files and reports remain ignored/private. This is game-specific coverage, not universal compatibility or hardware-timing certification.

## Sprite and tile catalog

The original `--catalog-stress` fixture supplies a moving two-pattern SATB slot, a visually similar stationary slot, a deliberate disappearance and reappearance, and repeated BAT tiles under scanline palette and scroll changes. The catalog retained both sprite alternatives, rejected a stale edit and wrong-HuCard import, followed animation and motion, and required a fresh pick after the slot returned. The native harness checked render-time selector coordinates, right-edge BAT wrap, scroll, color and admitted sprite patterns at 256, 320 and 512 pixels. Turning catalog attribution off and on produced identical serialized core state and composite PNG.

Four saved observations cover sprite and tile in live play at frame 3 and read-only replay at frame 7. Live captures survived eviction. Replay notes retained the pinned frame and input-row identity after advancing to frame 27. Two replays produced the same track and left the entire BK2 byte-for-byte unchanged. Two further notes were attached while replay was running, with playheads at frames 7 and 8 and saved captures at frame 3. After a catalog edit and cold server restart, all four original notes reopened with their original definitions, images and capture digests. The offline verifier passed all four ZIPs and checked the archived BK2s.

In the final five-second continuous-play sample, the optimized tracker followed the selected repeated BAT occurrence on all 64 observations. Both phases averaged about 59 emulated frames per second. Observed capture copy p95 was 0.80 ms with catalog capture off and 0.84 ms while tracking. End-to-end observation p95 was 29.24 ms. The samples reported zero invalid packets, skipped producer captures or delivery drops. Stream history stayed at 16 packets and the active three tracker leases retained eight results. This was a short single-machine workload. Headless Chromium exercised pixel pick, catalog creation, isolation, follow, exact-frame bug attachment, return to live and opening saved sprite evidence with the emulator disconnected.

The ignored `rea/test-output/catalog-lab/rea/test-output/catalog-report.json` records the native results and local bundle references. From a fresh isolated catalog fixture on ports 8930 and 8931, run `node ./rea/test/verify-catalog.mjs` and then `node ./rea/test/verify-catalog.mjs measure`. After restarting only the server against that same evidence directory, run `node ./rea/test/verify-catalog.mjs cold`.

Reproduce:

```powershell
./rea/Build.ps1
./rea/Test.ps1 -Harness
./rea/Start-REA.ps1 -Diagnostic -Mute
./rea/Test.ps1 -Native -Sustained
# Close this installation, relaunch the same diagnostic, then:
node ./rea/test/verify-cold.mjs
```

Optional local supplied-game test: launch that explicitly provided asset, then `node ./rea/test/verify-game.mjs`. It refuses other game names and never writes outside ignored session/output folders. Original diagnostic source is [make_test_rom.py](make_test_rom.py). CD, SuperGrafx, firmware/controllers, exact subscanline/fetch provenance and bounded REA trace/watch remain separate unavailable projects. Commercial timing suites and every possible geometry transition have not been exhaustively exercised.
