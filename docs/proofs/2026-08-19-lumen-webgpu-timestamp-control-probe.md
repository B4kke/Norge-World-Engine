# LUMEN WebGPU timestamp control probe

## Purpose

The existing WebGPU renderer reports adapter support for `timestamp-query`, but adapter support alone does not prove the feature is enabled on the created GPU device. This probe makes that distinction explicit.

## Implemented

- Added a deployable control page at `apps/world-viewer/webgpu-timestamp-probe.html`.
- Added `src/webgpuTimestampProbe.mjs` and browser entry wiring.
- The probe checks adapter support, requests `timestamp-query` explicitly when available, verifies it on the device, executes an empty timestamped compute pass, resolves two 64-bit timestamps, and rejects zero or non-monotonic pairs.
- Added a Node regression covering feature selection and timestamp-pair interpretation.
- Added the regression to the normal World Viewer build and the page to the Vite multi-page output.

## Evidence boundary

This is a control probe only. It does not measure Nannestad world rendering and must not be used as WebGPU-vs-WebGL2 performance evidence. RuntimeVerificationBundle behavior, compiled-artifact consumption, streaming lifecycle and raw-source blocking are unchanged.

## Next

Run this page on the same physical Android Chrome device intended for the renderer A/B. If the control probe returns a valid timestamp interval, integrate timestamp writes into the same-artifact WebGPU benchmark path and keep the existing comparability gates.
