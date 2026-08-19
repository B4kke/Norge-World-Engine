# LUMEN WebGPU timestamp control probe

## Purpose

The existing WebGPU renderer reports adapter support for `timestamp-query`, but adapter support alone does not prove the feature is enabled on the created GPU device. This probe makes that distinction explicit.

## Implemented

- Added a deployable control page at `apps/world-viewer/webgpu-timestamp-probe.html`.
- Added `src/webgpuTimestampProbe.mjs` and browser entry wiring.
- The probe checks adapter support, requests `timestamp-query` explicitly when available, verifies it on the device, executes an empty timestamped compute pass, resolves two 64-bit timestamps, and rejects zero, reversed, or zero-duration timestamp pairs.
- Added a Node regression covering feature selection and timestamp-pair interpretation, including fail-closed handling when begin and end are equal.
- Added the regression to the normal World Viewer build and the page to the Vite multi-page output.

## Evidence hardening — 2026-08-19

After syncing `agent/lumen-hourly` with current `main` without force, the timestamp interpreter was reviewed adversarially. It previously accepted `begin === end` as `PASS` with an elapsed interval of 0 ns. Such a pair can occur when timestamp resolution/quantization is too coarse for the measured empty pass and is not useful positive timing evidence. Equal non-zero timestamps now return `INCONCLUSIVE / ZERO_DURATION_TIMESTAMP` instead of PASS. Reversed timestamps remain `NON_MONOTONIC_TIMESTAMP`; timestamps containing zero remain `ZERO_TIMESTAMP`.

This is deliberately claim-calibration, not a performance optimization.

## Evidence boundary

This is a control probe only. It does not measure Nannestad world rendering and must not be used as WebGPU-vs-WebGL2 performance evidence. RuntimeVerificationBundle behavior, compiled-artifact consumption, streaming lifecycle and raw-source blocking are unchanged.

A positive control result proves only that this browser/device can enable and execute WebGPU timestamp queries with a non-zero monotonic interval for the probe. It does not prove useful timestamp resolution for the real renderer, physical GPU identity, Android performance, or architectural superiority of WebGPU.

## Next

Use automated environments with a genuine WebGPU backend when available. At a later batched device milestone, the same page can be run on the target Android Chrome device. If the control probe returns a valid timestamp interval, integrate timestamp writes into the same-artifact WebGPU benchmark path and keep the existing comparability gates.
