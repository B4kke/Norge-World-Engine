# apps/world-viewer

Minimal browser/runtime consumer and measurable viewer boundary for Norge World Engine.

## Deployable app boundary

`index.html` + `src/` form the deployable Vite application shell for the browser viewer. Vite is only the replaceable web build/development tool; it does not select WebGPU, WebGL2, Three.js, Cesium, terrain format or world-coordinate policy.

The deployable shell is intentionally built **around**, not instead of, the viewer/runtime work already in this directory:

- `artifact_consumer.mjs` remains the compiled-artifact browser gate and now requires full WebCrypto/JCS RuntimeVerificationBundle reconstruction before decode;
- `benchmark/` remains the real-artifact WebGL2 batching measurement harness;
- the Vite entrypoint does not fabricate terrain, roads or buildings while hosted runtime-artifact distribution is still open.

Current Vercel contract:

- Root Directory: `apps/world-viewer`
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: automatic/default

A successful Vercel deployment proves the web application shell can be hosted. It is not yet evidence that the accepted Nannestad terrain artifact, terrain worker/streaming path or renderer performance are integrated into that deployment.

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