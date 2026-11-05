# TURBO REAPER specification

Protocol 1, product **TURBO REAPER - BizHawk**, 5 November 2026. Standard PC Engine/TurboGrafx-16 HuCards in an isolated BizHawk 2.11.1 / PCEHawk installation. Native diagnostics and local game checks are listed in [VALIDATION](VALIDATION.md); they do not certify every mapper/game.

One managed VDC execution supplies actual final output, post-background samples and admitted sprite samples before BG priority. Sprite index and palette index are recorded per admitted pixel, including sprites behind opaque BG. Source classification records BG/sprite/backdrop. Alpha distinguishes transparent pixels, shown on checkerboards. No settings-toggle re-emulation produces layers. There is no invented BG2–4. BAT, first 256 BG patterns, palette and SATB bounds are completed-frame memory diagnostics; rectangles are not game collision boxes.

PCEHawk uses a scanline/cache renderer. Samples retain palette, scroll, masking, clipping and sprite-limit decisions at that renderer's composition points. They do not establish hardware-perfect fetch timing, subscanline changes or CPU/DMA provenance. Stable 256/320/512 widths are exercised. Mid-frame pitch/height changes invalidate capture, even when final geometry returns to its initial value. A guarded constructor allocation fix reserves `512*262` framebuffer pixels: stock upstream reserves `320*262` despite allowing a 512-pixel pitch. Composition logic is unchanged. Border output may be cached by the core; no earlier fetch is invented for it.

Geometry includes pitch, crop, requested size, VCE clock control and effective sprite limit. The video provider reports nominal 60/1; clock-derived cadence is separately `21477270/(1365*scanlines)`. Unknown ROMs can force the upstream sprite limit even when its settings checkbox is off. Capture exposes configured/effective values separately.

Observer state is a ConditionalWeakTable outside emulated savestates. Capture IDs combine process session and monotonic sequence, independent of emulated frame. State load invalidates raster evidence until a fresh complete render. Six detached producer buffers feed an off-thread encoder/transport; emulation never waits for browsers. History and query pools each retain 16 packets. Up to 16 owner/slot leases expire after 120 seconds, renewed by the browser every 30 seconds for selected evidence and baseline. Explicit missing IDs fail. Native/browser queues and decoder pools are bounded. Eight streaming viewers maximum, six pending writes per viewer.

Copied domains avoid both System Bus domains: Main Memory 8192 bytes, VRAM1 65536, VCEPalette 1024, SATB 512 and VDC Registers 64, plus actually available writable battery/cartridge backing arrays. Offsets are bytes. VRAM1/VCEPalette use upstream Big-endian word presentation; SATB/registers use explicit Little-endian words. MPRs, CPU registers and cycles accompany each capture. Logical resolution currently reads only safely copied base RAM mirrors; other regions return unavailable reasons. Immutable raw ROM reads are separate from mapper address resolution and per-frame memory copies.

Identity covers HuCard checksum, exact core/observer/tool digest, core/version, sync/render settings and game-database options. Checkpoints add SHA256 state sidecars. Standard HuCards require no firmware. Machine state includes the selected core's CPU/MPR/timer/interrupt/VDC/VCE/DMA/PSG/input/writable-storage serialization. Inspection snapshots never substitute for it.

All listeners bind loopback. Host/Origin, POST token, WebSocket origin, request sizes, packet layout and IDs are checked. Native producers authenticate with a per-launch token. No API accepts arbitrary filesystem paths, shell commands or memory writes. Controls acknowledge requested/completed frames; Pause can interrupt a step at a completed-frame boundary. Read-only movies reject scripted buttons. General checkpoints require stopped movies. A timeout means unknown outcome and is never retried automatically.

| Route | Contract |
| --- | --- |
| GET `/api/session` | Schema/product/token, distinct producer/machine/capture states, asset identities, features/reasons, metrics |
| GET `/api/snapshot`, `/api/history` | Explicit capture metadata and finite history |
| POST `/api/pin`, `/api/unpin` | Owner UUID, evidence/baseline slot, monotonic generation and capture ID; finite renewable retention |
| GET `/api/live`, WS `/stream` | Native packet; bounded lossless BGRA atlas using word-RLE/raw fallback |
| GET `/api/memory` | Snapshot/domain/start/length; 1–4096 bytes, clipped at end |
| GET `/api/diff`, `/api/compare` | Compatible explicit live/saved pairs and changed-byte records |
| GET `/api/logical` | Captured MPR mapping, safe base RAM byte or explicit unavailable reason |
| GET `/api/rom` | Verified raw HuCard bytes/SHA256, bounded immutable ranges, no implied mapper mapping |
| GET `/api/pixel`, `/api/sprites`, `/api/image` | Evidence-bound samples, hardware bounds and lossless PNG |
| POST `/api/control` | pause/resume/step/speed; record/play/movie-save/movie-stop/movie-inputs; checkpoint-save/load; tastudio; capture-rate; raster-enable; state-hash; shutdown |
| GET `/api/movies`, `/api/checkpoints` | Native BK2 and compatible persistent-state catalogs |
| GET/POST `/api/annotations`, POST `/capture` | Persistent exact evidence, revision-checked notes with prior revisions |
| GET `/api/annotations/<id>/{pixel,memory,image,capture.bin,snapshot.json,...}` | Saved inspection after eviction/restart, independent of machine |
| GET `/api/export`, `/api/annotations/<id>/investigation.zip` | Offline-verifiable ZIP; ROM/firmware excluded by default |
| GET `/api/metrics`, POST `/api/viewer` | Measured machine/capture/unique-viewer rates and memory/queue counts |

Comments preserve immutable packets and matching local movie bytes where available. No movie archive is claimed when its version cannot be matched. Drafts are browser localStorage; revisions/captures persist on disk. Exports are inspection bundles. State-started BK2 files independently embed native starting state; general checkpoints are not silently exported. Full native packet retention supports saved pixel/memory inspection after server restart without rewinding the machine.

Unavailable projects: CD/SuperGrafx/System Cards/Arcade Card/controller extensions, bounded REA CPU trace/watch, joined fetch provenance, ROM-specific game collisions, alternate cores and browser timeline/branch editing. Native TAStudio and core-dependent debugger tools remain separate. Mock protocol tests do not prove native correctness. See [PARITY](PARITY.md) and [VALIDATION](VALIDATION.md) for exact coverage.
