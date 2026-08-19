# STRØM proof — resident-budget preemption failure containment

**Date:** 2026-08-19  
**Gate:** `P0-STREAMING-01`  
**Evidence class:** renderer-neutral scheduler regression / hosted CI pending exact-head result.

## Problem

Priority-preserving resident-byte preemption calls the injected `deactivateTile` adapter before a higher-priority cached tile may become resident. If that adapter throws, propagating the exception out of `#makeResidentBudgetRoom()` can turn a recoverable resource-pressure condition into a rejected scheduler update or an unrelated async `lifecycle-failed` path.

A renderer-resource deactivation failure does not create memory headroom, so the higher-priority candidate must not activate and the hard resident-byte cap must not be exceeded. But the scheduler should retain both valid payloads and remain operable.

## Change

`TileStreamingScheduler` now contains failures specifically while attempting `resident-budget-preempted` deactivation:

- `#deactivate` still records the ordinary `deactivationFailures` metric and `deactivation-failed` event and preserves the incumbent as resident;
- `#makeResidentBudgetRoom` catches that adapter failure at the budget-policy boundary;
- `residentBudgetPreemptionFailures` records failed preemption attempts separately from successful `residentBudgetPreemptions`;
- `resident-budget-preemption-failed` exposes candidate tile id, incumbent tile id and error text;
- the scheduler may try another lower-priority resident if one exists;
- if enough room still cannot be created, activation is deferred through the existing `activation-deferred-budget` path;
- no resident-byte overcommit is permitted and no payload is discarded merely because renderer deactivation failed.

This does not weaken errors for ordinary interest-loss deactivation or disposal. Those paths keep their existing semantics.

## Negative regression

`test_tile_scheduler_resident_priority.mjs` now includes a fourth case:

1. establish a 100-byte lower-priority tile as resident under a 100-byte resident cap;
2. load a nearer 100-byte candidate;
3. make the injected renderer-neutral `deactivateTile` throw only for `resident-budget-preempted`;
4. require scheduler update/idle completion rather than rejection;
5. require incumbent `resident`, candidate `cached`, `bytesResident=100`, `bytesCached=100`, and `residentBudgetOvercommitBytes=0`;
6. require `residentBudgetPreemptions=0`, `residentBudgetPreemptionFailures=1`, `deactivationFailures=1`, `residentBudgetDeferrals=1` and `lifecycleFailures=0`;
7. require one explicit `resident-budget-preemption-failed` event and one activation-budget deferral.

The original priority inversion, oversized-candidate and deterministic tie-break regressions remain in the same suite.

## Boundaries

No numeric production resident/cache/GPU budget is selected. No renderer backend logic is introduced into streaming core. RuntimeVerificationBundle, raw-source networking and DTM1 seam policy are untouched.

## Acceptance

Exact-head baseline must report `resident budget priority regressions: PASS (4 cases)` together with the existing scheduler/runtime suites before this proof is upgraded from implementation evidence to hosted CI PASS.
