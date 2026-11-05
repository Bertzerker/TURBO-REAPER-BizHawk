# Interface parity — 5 November 2026

Compared with current workspace NES/FCEUX, Genesis/BlastEm and SNES/BizHawk source, including SUPER REAPER's setup/test reference. Those trees were read-only. Source reuse does not transfer native validation between consoles.

| Capability | TURBO REAPER | Current references |
| --- | --- | --- |
| Dark shell, one toolbar, graphics/inspector, drawers | UI | Current MIT SNES shell and shared visual tokens |
| One-run raster views | UI/API output, one BG, admitted sprites, source | NES BG/OBJ; Genesis A/B/window/OBJ/source; SNES BG1–4/OBJ/main-sub; meanings differ |
| Pattern/BAT/palette/SATB diagnostics | UI/API, memory-only labels | Console-specific diagnostics in all references |
| Pinned pixels, frozen/saved review, memory baseline | UI/API, finite renewable leases | Current SNES selection model, beyond dated review |
| Execution / speed / bounded input | UI/API, 1–3600 frames, interrupt at frame boundary | Similar SNES/NES contracts; Genesis differs |
| Persistent whole-machine checkpoints | UI/API, compatibility/hash sidecar | SNES persistent; NES session slots; Genesis native/movie-start workflow |
| Native input movies | UI/API BK2 transport/library/input rows | SNES BK2; NES FM2; Genesis own format |
| Timeline editing | Native TAStudio; no browser branches/seek | SNES TAStudio; NES TAS Editor |
| Comments/drafts/revision conflicts/saved review | UI/API, retained prior note revisions | Current MIT SNES approaches |
| Offline-verifiable export | UI/API ZIP + SHA256, optional archived BK2 state/input | Native movie formats preserved; no cross-console replay claim |
| Logical/physical banking | Captured MPR + safe RAM resolution; immutable raw ROM route | Console-specific mapping, no fake CPU bus domain |
| Bounded CPU trace/watch | Unsupported REA service, native debugging separate | NES implements bounded trace evidence; others differ |
| Joined pixel-to-CPU/DMA provenance | Unavailable | No universal reference implementation |
| Game collision semantics | Unavailable | NES explicit game-scoped adapters; hardware bounds differ |
| CD/SuperGrafx/extended controllers | Unavailable REA modes | Separate diagnostics and contracts required |

See [validation](VALIDATION.md) for native and browser coverage and [SPEC](SPEC.md) for exact limits.
