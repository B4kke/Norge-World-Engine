# LUMEN device-evidence build boundary — 2026-08-18

## Scope

This proof belongs to the deployable `apps/world-viewer` measurement surface. It does not change world compilation, streaming lifecycle, coordinate policy, RuntimeVerificationBundle semantics or renderer architecture selection.

## Problem falsified

The existing `nwe.world-viewer-device-evidence/0.1` comparison gate already required matching accepted artifacts, provenance result, graphics profile, camera, render surface and device metadata. It could still report two captures as comparable when they came from different viewer commits or different repeated-draw measurement windows. That makes a WebGL2/WebGPU A/B vulnerable to code drift or a 90-frame-vs-120-frame comparison being treated as controlled evidence.

## Change

- Vite injects the deployment Git SHA from `VERCEL_GIT_COMMIT_SHA` (with `GITHUB_SHA` as a non-Vercel build fallback) and the Vercel deployment id into the static viewer build.
- Device evidence persists the viewer Git SHA and deployment id.
- `compareDeviceEvidenceContext()` now requires the same viewer Git SHA, requested/measured frame window, accepted artifact hashes, full verification codes, graphics profile, explicit renderer workload (`max_dpr`, `msaa_samples`, `power_preference`), first-frame camera, render surface and device metadata.
- Missing build identity makes the comparison non-comparable rather than silently accepting it.
- Evidence filenames include the short viewer commit SHA to reduce accidental cross-build mixing.
- Runtime raw-source blocking and full RuntimeVerificationBundle verification are unchanged.

Vercel's official system-environment documentation defines both `VERCEL_GIT_COMMIT_SHA` as the Git SHA that triggered a deployment and `VERCEL_DEPLOYMENT_ID` as the unique deployment identifier. Vite's build-time `define` mechanism is used only to make those build facts available to the browser evidence exporter; no credential or source-data path is exposed.

## Validation

Focused structural regression covers:

1. same commit/device/artifacts/camera/surface/workload/window with different requested backend -> comparable;
2. changed camera -> not comparable;
3. changed backing buffer -> not comparable;
4. changed viewer commit -> not comparable;
5. changed repeated-draw frame window -> not comparable;
6. missing viewer commit -> not comparable;
7. raw source runtime URL -> fail closed;
8. non-PASS provenance -> fail closed.

The exact branch head must still pass the normal `baseline`, `world-viewer-vite`, `viewer-benchmark` and real-data publish gates. Vercel Preview is deployment/smoke evidence only and must be tied to that same Git SHA before it is reported as exact-head evidence.

## Evidence class / non-claims

This hardens benchmark comparability and deployment identity. It is not Android performance evidence. It does not prove WebGPU faster than WebGL2, does not select WebGPU/WebGL2/Cesium, and does not upgrade debug building heights or other visual fallbacks to world truth.

## Next gate

Capture forced WebGL2 and forced WebGPU, where supported, on the same physical Android Chrome device from the same exact viewer commit and accepted artifact set. Interpret timing only when `compareDeviceEvidenceContext()` returns `comparable=true`; then compare first-visible, frame p50/p95/p99/max, draw calls, resource apply/upload, retained memory and available GPU timing/capability data.
