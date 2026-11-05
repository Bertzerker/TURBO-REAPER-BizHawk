# TURBO REAPER - BizHawk

Local TurboGrafx-16 / PC Engine HuCard reverse-engineering workbench based on an isolated BizHawk 2.11.1 / PCEHawk installation.

Native raster capture, controls, durable evidence, BK2 movies, compatible checkpoints and the shared workbench are implemented. This is a source build with explicit scanline-renderer limits; see the validation report for tested configurations.

```powershell
./rea/Build.ps1
./rea/Start-REA.ps1 -Diagnostic -Mute
```

Open <http://127.0.0.1:8920/>. See [run/API guide](rea/README.md), [core selection](rea/CORE-SELECTION.md), [specification](rea/SPEC.md), [validation](rea/VALIDATION.md), [parity](rea/PARITY.md) and [integration notes](INTEGRATION-NOTES.md).

Default ports: HTTP 8920 and native duplex stream/control 8921; configurable. CD, SuperGrafx and extended controllers are unavailable REA capabilities. No commercial ROMs or firmware are included.

BizHawk's license notice is preserved in [LICENSE.BizHawk](LICENSE.BizHawk). New original REA code is MIT licensed under [rea/LICENSE](rea/LICENSE); copied upstream components retain their existing notices and licenses.
