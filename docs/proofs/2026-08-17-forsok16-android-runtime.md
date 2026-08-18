# Forsøk 16 — Android REAL DTM1 runtime evidence

Date: 2026-08-17  
Device class: Android / Chrome-family browser  
Evidence type: user-supplied oblique runtime screenshot + exact Forsøk 16 harness inspection

## Scope

This proof records what the Android Forsøk 16 capture actually establishes for the Nannestad Prototype-0 viewer. It does not promote building debug heights, road widths, imagery, renderer choice or whole-Norway terrain format to authoritative decisions.

The harness consumes the already proven compiled road, building and DTM1 terrain artifacts. Source-service networking for Kartverket DTM1, NVDB, OSM and Overpass is absent/hard-blocked in normal runtime.

## Screenshot-observed runtime state

The captured HUD reports:

- road artifact: `PASS`
- road paths: `246`
- road length: `14.89 km`
- building artifact: `PASS`
- footprints: `135`
- building heights: `15 source · 120 debug`
- terrain artifact: `PASS`
- DTM samples: `1,000,000 · 1 m`
- DTM range: `168.97–197.62 m`
- DTM decode / mesh: `1.3 / 19.4 ms`
- runtime proof: `READY ×3`
- boot: `220 ms`
- draw calls at the captured camera: `224`
- frame: `16.7 ms · 60 FPS`
- renderer memory counters: `382 geo · 2 tex`
- raw source network: `BLOKKERT · 0 KALL`

The screenshot itself is 709×1536 pixels. That is only capture metadata and is not treated as the renderer's physical device resolution.

## Harness facts relevant to interpretation

Forsøk 16 keeps the compiled DTM1 artifact at 1 m / 1000×1000 as world truth, but samples it to a 129×129 GPU terrain mesh for this mobile proof. Terrain sampling is bilinear from the verified height grid.

Road centerline points use valid NVDB NN2000 Z where present and DTM1 as the fallback ground height. The current road ribbon gives both lateral road-edge vertices the centerline height; therefore it is still a topology/visual road surface, not an authoritative crossfall/camber/asphalt surface model.

Building bases are grounded by averaging DTM1 samples at footprint vertices. Only 15 of 135 building heights are source-backed; 120 unresolved heights are rendered as an explicit 5 m debug fallback.

World Imagery is a visual sensor layer only and is not part of world-truth provenance.

## What the Android capture proves

1. **Real terrain reached the device/runtime boundary.** The user-visible harness reports the expected terrain artifact as PASS together with road and building artifacts.
2. **No gross coordinate/origin/Z failure is visible.** Terrain relief, imagery, road network and building footprints occupy the same Nannestad world area in an oblique view.
3. **The current mobile scene can sustain the captured view at 60 FPS.** The reported average is 16.7 ms / 60 FPS.
4. **Terrain decode is cheap in this one-tile case; mesh construction is not free.** 1.3 ms decode is small, while 19.4 ms mesh construction exceeds one 60 Hz frame budget and could cause a hitch if repeated synchronously during streaming.
5. **Per-object renderer pressure remains substantial.** The captured view reports 224 draw calls and 382 geometry objects.

## What it does not prove

- Sub-meter XY alignment. A single oblique screenshot can reject gross offset but not establish survey-grade agreement.
- Authoritative building volumes. 120/135 building heights are still debug fallback.
- Authoritative road surface width/crossfall. Width remains a visual/topology policy and the current ribbon does not independently terrain-sample left/right edges.
- Bridge/tunnel/grade-separation correctness across all 246 paths.
- Stable 60 FPS under movement, worst-case camera, thermal throttling or multi-tile streaming.
- First-visible latency as a distinct metric; the HUD currently reports boot time, not an independently instrumented first-visible timestamp.
- Successful batching. The reduction from the prior ~391-call Forsøk 15 observation to 224 calls is not comparable without identical camera/view; the harness still creates separate road/building geometries.

## Consequences / next measurements

- Use the captured Forsøk 16 state as the new device baseline for P0-VIEWER-01.
- For Issue #5, compare per-object vs batching with the **same camera** and same artifact bytes; record draw calls, frame-time distribution, geometry count, scene-build and source-debug traceability.
- Add explicit first-visible and p50/p95/p99 frame-time instrumentation rather than relying on one averaged 60-frame value.
- Exercise a camera/view that maximizes visible geometry before accepting a draw-call target.
- Before dynamic terrain streaming, test terrain mesh construction off the main thread or incrementally because the measured 19.4 ms one-tile build already exceeds one 60 Hz frame budget.
- Keep the current distinction between geographic correctness and visual completeness: terrain/footprints are real-data artifacts; most building Z and road physical surface semantics remain open.
