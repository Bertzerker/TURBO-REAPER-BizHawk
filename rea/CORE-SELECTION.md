# Core selection

Selected 5 November 2026: BizHawk 2.11.1 / PCEHawk, initially standard PC Engine/TurboGrafx-16 HuCards.

The local pinned source provides directly instrumentable managed VDC background/sprite composition, copied memory domains, CPU debugging and whole-machine savestates. BizHawk supplies BK2 input movies and TAStudio. The implementation will use its own emulator files and instrument only its own copy; the existing SNES installation remains unchanged.

PCEHawk is a scanline renderer. Captures reproduce that renderer's admitted inputs and palette resolution, not hardware-perfect sub-scanline behavior. End-of-frame VRAM, SATB and palette previews are memory diagnostics. SuperGrafx and CD modes are not part of the first validated scope.

Alternatives examined: TurboNyma/Mednafen PCE and HyperNyma wrappers expose GPU cache diagnostics, but real native render-input capture requires deeper native modifications. Mednafen's documented timing fidelity is stronger than PCEHawk's scanline model; the selected path prioritizes an explicit, verifiable observer boundary and native movie/state integration, not an assertion of superior emulation accuracy.

Authoritative references: [BizHawk 2.11.1](https://github.com/TASEmulators/BizHawk/releases/tag/2.11.1), [Mednafen PCE documentation](https://mednafen.github.io/documentation/pce.html).

The isolated instrumentation build uses Mono.Cecil 0.11.6 from NuGet (MIT), download SHA256 `D2A23832AAA948BA9A01ACC42B5726E34C5F995958F1B30D45C0E7C70B3A72D5`. It must validate exact input assembly identity and hook structure before modifying a private copy. Observer storage must not enter emulated savestates.
