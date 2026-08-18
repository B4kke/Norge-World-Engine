# LUMEN device capture-session boundary — 2026-08-18

## Scope

This proof hardens `apps/world-viewer` benchmark evidence only. It does not alter compiled artifacts, RuntimeVerificationBundle semantics, streaming policy, world coordinates or renderer selection.

## Problem falsified

The previous comparison gate matched exposed browser/device metadata, build SHA, artifact hashes, camera, render surface and measurement window. That still could not prove that two captures came from the same physical handset: two identical phones can expose the same user agent, screen, DPR, memory and concurrency values.

Treating metadata equality as physical-device attestation would therefore overclaim the evidence class.

## Change

- `device-evidence.html` now creates a UUID capture-session id when none is supplied and writes it into the URL so the same browser tab/session can carry the id across forced WebGL2/WebGPU runs.
- Device evidence persists `capture.session_id` and `capture.target`.
- `compareDeviceEvidenceContext()` now requires the same non-empty capture session in addition to the existing build/artifact/camera/surface/workload/device constraints.
- `target=android-chrome` performs a conservative Android + Chromium/Chrome browser-signal gate using User-Agent Client Hints where exposed, with UA fallback and exclusions for known alternate Chromium browsers.
- The evidence explicitly records `physical_device_attested: false`; browser metadata and a shared session id reduce accidental mixups but do not cryptographically attest physical hardware identity.
- Raw-source runtime blocking and full provenance verification remain unchanged.

## Validation

Focused Node regression passes and covers:

1. same session/context with forced WebGL2 vs WebGPU -> comparable;
2. changed capture session -> not comparable;
3. missing capture session -> not comparable;
4. Android Chrome target with desktop browser signals -> fail closed;
5. Edge-on-Android-like UA -> not classified as Chrome;
6. existing changed camera/render surface/build/window rejections remain intact;
7. raw-source URL and non-PASS provenance still fail closed.

## Evidence class / non-claims

This is structural benchmark-validity evidence. It does not prove Android performance, does not prove two captures were made on one physical phone, and does not select WebGPU/WebGL2/Cesium.

The current WebGPU specification exposes adapter features, limits and user-agent-controlled adapter information, but user agents deliberately retain control over how much machine-specific detail is exposed. Browser-visible hardware metadata is therefore useful diagnostics, not a physical-device identity primitive.

## Next gate

Run both backends from the same exact Vercel viewer commit with `target=android-chrome` and the same `session` value on one operator-controlled physical Android Chrome handset. Treat `comparable=true` as context-consistency evidence, while the physical-device identity remains an external/device-lab assertion.
