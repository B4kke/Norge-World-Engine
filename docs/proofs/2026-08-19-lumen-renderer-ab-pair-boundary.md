# LUMEN proof — renderer A/B backend-pair boundary

Date: 2026-08-19

## Scope

This increment advances `P0-VIEWER-DEVICE-COMPARABILITY-01` by hardening the renderer-comparison acceptance boundary in `apps/world-viewer`. It is a structural evidence-validity change only. It does not claim Android performance and does not select WebGPU, WebGL2 or Cesium.

## Main synchronization

Persistent branch `agent/lumen-hourly` was synchronized without force from current `main` `6d283d498b05f3b4b5173c65a55474f85626a748` through two-parent merge commit `9c821e9f645e4ea9e7b8cb0155f470cf79cdf7a0`. The incoming STRØM change added the renderer-neutral movement-trace validator and baseline coverage; it did not overlap LUMEN-owned viewer files.

## Evidence-validity defect

The previous `compareDeviceEvidenceContext()` gate checked build identity, capture session, accepted artifact hashes, verification, graphics workload, camera, render surface, measurement window and exposed device/browser context. It did not require the two accepted captures to be different renderer backends.

Therefore, two WebGL2 captures with identical context could return `comparable=true`. A WebGPU request that fell back to WebGL2 could also be mistaken for useful backend A/B evidence if a caller only checked context comparability. That is not valid WebGPU-vs-WebGL2 evidence.

## Implementation

The comparator now fails closed unless:

- both requested and active backends normalize to `webgl2` or `webgpu`;
- requested backend equals active backend for each capture, rejecting renderer fallback with `backend_fallback`;
- the pair contains exactly one active WebGL2 capture and one active WebGPU capture, otherwise rejecting with `backend_pair`;
- all previously required build/session/artifact/provenance/workload/camera/surface/window/device context remains identical.

The evidence interpretation string now states the non-fallback backend-pair requirement explicitly. Runtime source/provenance behavior is unchanged: full `RuntimeVerificationBundle` verification remains mandatory and raw source runtime calls remain fail-closed.

## Negative regression coverage

`apps/world-viewer/test_device_evidence.mjs` now proves:

1. same-context WebGL2 + WebGPU remains comparable;
2. WebGL2 + WebGL2 is rejected with `backend_pair`;
3. requested WebGPU that actually runs WebGL2 fallback is rejected with `backend_fallback` + `backend_pair`;
4. all existing session, build, camera, render-surface, measurement-window, Android-Chrome target, raw-source and provenance negatives remain present.

## Evidence class and non-claims

This is structural/unit evidence. It makes accidental false-positive renderer comparisons harder; it does not attest a physical handset, provide Android timing, prove WebGPU support on a target phone or justify renderer architecture selection. Vercel Preview, when exact-head, is deployment/smoke evidence only.

## Next gate

Run one operator-controlled physical Android Chrome handset against the exact deployable commit. Capture forced WebGL2 and forced WebGPU, where supported, with the same session, accepted artifact identities, camera, graphics workload, render surface and measurement window. Interpret first-visible, frame p50/p95/p99/max, draw calls, GPU/resource apply and retained memory only when `compareDeviceEvidenceContext()` reports `comparable=true`.
