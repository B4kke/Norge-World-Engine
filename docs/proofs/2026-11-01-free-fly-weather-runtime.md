# Free-fly camera + dynamic Nannestad weather runtime — 2026-11-01

## Scope

This proof records a renderer-only WebUI slice on draft PR #85. It does **not** change authoritative NWE world coordinates, source geometry, simulation state, provenance, or the active LiDAR source-fidelity decision.

Code evidence is bound to implementation head `548c89fb90b1cce17bb948d30fdc29c1174d768d` (parent code is unchanged by this documentation commit).

## Free-fly / bird camera

- `F` toggles grounded first-person and detached `free-fly`.
- Keyboard: `WASD` horizontal flight, `Space`/`E` up, `Q`/`Ctrl` down, `Shift` boost, `Alt` precision.
- Touch controls are injected for fly mode and the normal character pad is hidden while detached.
- `?camera=fly` starts directly in free-fly.
- Character authoritative movement remains independent. While detached, character follow updates only remember the latest player pose; returning to walk mode reattaches to that pose.
- The bounded directional shadow frustum follows the detached camera horizontally while keeping the latest grounded anchor height.

## Atmosphere, sun, clouds and weather

`threeWeatherModel.mjs` defines renderer-only weather presets:

- `clear`
- `partly-cloudy`
- `overcast`
- `rain`
- `fog`

The active weather can be selected in the WebUI, cycled with `V`, or selected with `?weather=<preset>`.

Three r185 `SkyMesh` is used for procedural sky/cloud presentation. Weather controls cloud coverage, density, elevation, scale and speed plus turbidity, Rayleigh scattering, Mie scattering, fog and ambient/environment strength.

Solar altitude/azimuth is calculated from the accepted Nannestad tile center (`60.21899101080523, 11.012531197026972`) and browser time using a NOAA-style approximation. Render coordinates remain `+X east, +Y up, -Z north`. The result drives the directional sun, daylight intensity, warm low-sun color and the visible SkyMesh sun direction.

Rain is a bounded deterministic camera-local particle layer whose budget is graphics-profile dependent. Wind direction/speed affects rain drift. This is intentionally portable across WebGPU and WebGL2 rather than a WebGPU-only compute dependency.

The PMREM environment remains an initial bounded capture; weather changes scale the existing environment contribution instead of rebuilding PMREM every frame.

## Truth boundary

The weather system is **presentation/simulation state only**. It does not claim that `rain`, `fog`, cloud amount or wind are live observations from MET Norway or any other meteorological provider. The astronomical sun direction is location/time derived; the selected weather itself is user-controlled renderer state.

No source-derived roof/canopy/near-field terrain claim changes as a result of this slice.

## Validation

Implementation head `548c89fb90b1cce17bb948d30fdc29c1174d768d`:

- `world-viewer-vite` run `41313605022`: PASS. This includes the complete package regression/build chain, exact Preview-1 renderer A/B, device-evidence smoke and synthetic 1000×1000 terrain worker gate.
- `baseline` run `41313604977`: PASS.
- `viewer-benchmark` run `41313605065`: PASS.
- `nvdb-road-semantics-proof` run `41313604982`: PASS.
- `nannestad-lidar-source-probe` run `41313604937`: PASS.
- Dedicated weather-model regression: PASS inside the world-viewer build.
- Dedicated free-fly/camera regression: PASS inside the world-viewer build.

The first implementation commit exposed one deterministic test interaction: the detached-camera shadow assertion and the scheduled 30-second solar refresh could both update the shadow anchor in one test frame. The production behavior was valid; the test was corrected to pin the solar clock before measuring the camera-only transition rather than weakening the assertion.

Exact screenshot/real-data publication workflows remain separate evidence. A provider/snapshot staging failure there is not to be reclassified as a camera/weather implementation failure without reaching the render step.

## Known limits / next graphics work

- Weather is controlled simulation, not live meteorology.
- No snow, thunder/lightning, stars/moon or wet-surface response is claimed yet.
- Cloud/atmosphere realism is Three `SkyMesh` procedural presentation, not CFD or volumetric meteorological simulation.
- The free camera can leave the currently loaded 1×1 km content; seamless traversal beyond it belongs to the existing future streaming/multi-tile track.
- The main realism priority remains the exact-byte LiDAR gold-tile gate before source-derived LoD2 roofs, canopy candidates or higher-detail near terrain are promoted.
