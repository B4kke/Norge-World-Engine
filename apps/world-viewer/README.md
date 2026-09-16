# apps/world-viewer

Minimal browser/runtime consumer and measurable viewer boundary for Norge World Engine.

## Ground-viewer visual quality

The default Nannestad view now uses the Three WebGPU-capable renderer with a
WebGL2 fallback and four explicit quality profiles. Desktop defaults to `high`;
small screens default to `balanced`. `high` and `ultra` add the TSL render
pipeline with bounded GTAO and restrained bloom, while lower profiles retain a
direct render path.

| Profile | Terrain grid | DPR cap | Texture filtering | Shadow map | Post effects |
|---|---:|---:|---:|---:|---|
| Low | 65² | 1× | 2×, no normal maps | 512² | Direct |
| Balanced | 129² | 1.5× | 4× | 1024² | Direct |
| High | 257² | 2× | 8× | 2048² | GTAO + bloom |
| Ultra | 513² | 2.5× | 16× | 4096² | Higher-sample GTAO + bloom |

Terrain, asphalt, timber walls and roof tiles use local 1K Poly Haven diffuse,
roughness and OpenGL normal maps. The adjacent asset catalog pins all web maps
and the Unreal DirectX normal variants by byte size, MD5 and SHA-256 under
CC0-1.0. Runtime never contacts Poly Haven. Material choice, tint, UVs, light,
fog and post processing are presentation only; they do not alter accepted DTM,
road or building geometry.

## Deployable app boundary

`index.html` + `src/` form the deployable Vite application shell for the browser viewer. Vite is only the replaceable web build/development tool; it does not select WebGPU, WebGL2, Three.js, Cesium, terrain format or world-coordinate policy.

The deployable app is built around the same runtime boundaries used by the repo benchmarks:

- `artifact_consumer.mjs` requires full WebCrypto/JCS RuntimeVerificationBundle reconstruction before JSON artifact decode;
- `benchmark/` remains the real-artifact WebGL2 vector batching measurement harness;
- **Forsøk 18** is now available from the main World Viewer viewport and drives terrain through the shared browser worker/scheduler experiment core.

Current Vercel contract:

- Root Directory: `apps/world-viewer`
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: automatic/default

A successful deployment proves the web application can be hosted. It is not by itself evidence that a particular renderer, tile format, device budget or whole-Norway streaming policy is accepted.

## Forsøk 18 — terrain runtime in the World Viewer

The main app exposes **Kjør Forsøk 18**. Default mode is deliberately labeled `SYNTHETIC STRUCTURAL`: it builds a 1000 × 1000 float32 terrain fixture in the browser and sends it through the same production-direction boundaries that a hosted real terrain artifact uses:

`RuntimeVerificationBundle -> WebCrypto/JCS -> NWEHGT01 decode -> module DedicatedWorker -> TileStreamingScheduler -> WebGL2 measurement upload/draw`.

The visible panel reports provenance status, DedicatedWorker status, first-visible, rAF gap, GPU apply time, cache hit and retained bytes. The camera then moves outside the active radius but remains inside the retain radius, forcing `resident -> cached`; returning to the tile must produce a scheduler cache hit without another terrain resolver call.

The synthetic fixture is a runtime/structure test only. Its shape and SHA are **not** Nannestad world truth.

A hosted accepted terrain bundle can use the same app path with explicit query parameters:

```text
?terrainBundle=/runtime/nannestad/terrain.bundle.json
&terrainTileId=<tile-id>
&centerE=<easting>
&centerN=<northing>
```

`terrain_runtime_input.mjs` still rejects raw-source transport references before the compiled-artifact request. Normal browser runtime must never acquire DTM/NVDB/OSM source data directly.

Exact hosted structural proof is recorded in `docs/proofs/2026-08-18-world-viewer-terrain-worker.md`. The current open gate is to drive the exact accepted Nannestad DTM1 RuntimeVerificationBundle/artifact through this same real browser-worker path, then repeat on Android Chrome.

## Compiled-artifact browser gate

Prototype 0 viewer code must consume **compiled artifacts**, never NVDB/OSM/Kartverket source APIs during normal runtime. `artifact_consumer.mjs` implements the browser gate for JSON runtime artifacts:

- fetch the runtime bundle;
- reject raw-source transport references before a second network request;
- fetch the compiled artifact only;
- reconstruct the complete RuntimeVerificationBundle graph with the shared browser verifier using RFC 8785/JCS + WebCrypto SHA-256;
- require `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS`;
- parse the artifact only after full graph and byte verification.

```js
import { loadCompiledJsonArtifact } from "./artifact_consumer.mjs";

const roads = await loadCompiledJsonArtifact({
  bundleUrl: "/runtime/nannestad/roads.bundle.json",
  expectedRole: "road-network",
});
```

Browser and Node verification share the same semantic core under `engine/streaming`; the viewer does not maintain a second provenance policy. Renderer selection remains open; this consumer boundary is intentionally renderer-independent.

## P0 vector batching benchmark

`benchmark/` is the repeatable repo-side benchmark for Issue #5. It intentionally uses dependency-free WebGL2 as a **measurement harness**, not as a renderer decision.

The benchmark loads the exact verified road/building artifacts, rebases EPSG:25832 XY to the 1 km tile origin before Float32 GPU upload, then renders the same shared line buffers in two modes:

1. `per-object`: one draw per road path and one draw per building footprint;
2. `batched`: one draw for all road line segments and one draw for all building outlines.

No coordinate is changed to make batching easier. Building height is deliberately not extruded in this microbenchmark: source-backed vs unresolved height metadata remains visible in debug/color semantics, while unresolved height is never converted into fake vertical world truth.

The fixed full-tile camera makes before/after draw-call counts directly comparable. The harness records artifact verification/decode time, geometry-build time, GPU upload time, first-visible time, frame-time/FPS distribution, draw calls, JS heap when Chrome exposes it, object/vertex counts, GPU buffer bytes, renderer strings and runtime network requests.

Clicking a visible object performs CPU-side hit testing against the original artifact coordinates and returns road `path_id` + source segment/sequence IDs or building `source_id` + height provenance. Normal rendering remains batched.

### Narrow regressions

```bash
node --check apps/world-viewer/benchmark/geometry.mjs
node --check apps/world-viewer/benchmark/benchmark.mjs
node --check apps/world-viewer/run_benchmark.mjs
node apps/world-viewer/test_benchmark_geometry.mjs
node apps/world-viewer/test_benchmark_params.mjs
node apps/world-viewer/test_artifact_consumer.mjs
```

### Real-artifact benchmark

Given an `nwe-compile-vectors` JSON report whose results contain `artifact_path` and `bundle_path`:

```bash
node apps/world-viewer/run_benchmark.mjs \
  --compile-report /tmp/nwe-viewer/compile.json \
  --output /tmp/nwe-viewer/viewer-benchmark.json
```

The runner independently checks each staged artifact's `REAL_COMPILED` role, byte size and SHA-256, serves only bundle/artifact bytes plus the repo browser-verifier modules and pinned local JCS dependency to Chrome, and fails if the browser contacts raw Norwegian source services or if the batched vector path does not get below the Issue #5 investigative 100-draw target.

`.github/workflows/viewer-benchmark.yml` produces the hosted reproducible measurement package. Device measurements remain separate evidence: hosted software-renderer frame times must not be presented as Android GPU performance.
