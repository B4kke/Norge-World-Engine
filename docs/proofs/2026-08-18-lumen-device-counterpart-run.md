# LUMEN same-session counterpart device run — 2026-08-18

## Scope

This proof hardens the operator path for the still-open Android Chrome WebGL2/WebGPU comparison. It does not add renderer policy, change RuntimeVerificationBundle semantics, or claim Android performance.

## Main sync

Persistent branch `agent/lumen-hourly` was synchronized without force from prior head `b8af4565aa50a537bbbcde8cee701015ac2d86fb` to current `main` `82bb1f725b5b4ee4ff3d669eb1857fcf6ec3d1a5` using two-parent merge `912b6d10c37ec4688abe00053b8a3a8751daa7e2`. The incoming STRØM #32 delta touched `engine/streaming`, CI and STRØM proofs; it did not overlap LUMEN's eight existing PR files.

## Problem found

The device-evidence contract required the same capture session, viewer build, artifacts, camera, workload, surface and measurement window, but the operator still had to edit the URL manually between WebGL2 and WebGPU captures. A typo or lost query parameter could silently produce a non-comparable second run.

## Change

`buildCounterpartEvidenceUrl()` now derives the opposite backend URL from the successful capture URL while preserving all existing query parameters, including `session`, `target`, `graphics`, `frames` and `previewManifest`. It fails closed when the session is missing or the active backend is not explicitly `webgl2`/`webgpu`.

The deployable `/device-evidence.html` exposes the counterpart link only when requested backend equals active backend. This avoids looping a failed WebGPU request that fell back to WebGL2. The link changes only renderer backend and keeps the rest of the run context intact.

A dedicated Node regression is part of the world-viewer production build and verifies forward/reverse backend switching, preserved session/workload parameters, and fail-closed missing-session/invalid-backend cases.

## Evidence boundary

- Full provenance reconstruction and raw-source blocking are unchanged.
- Counterpart URL determinism reduces operator error; it does not attest the physical handset.
- Vercel Preview remains deploy/smoke evidence only.
- Android Chrome timing remains unproven until one controlled physical handset executes both captures and `compareDeviceEvidenceContext()` reports `comparable=true`.
- No WebGPU/WebGL2/Cesium architecture decision is made.
