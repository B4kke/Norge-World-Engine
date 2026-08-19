# STRØM proof — resident-byte budget priority preservation

**Date:** 2026-08-19  
**Scope:** `P0-STREAMING-01`, renderer-neutral `TileStreamingScheduler` behavior under a caller-supplied `maxResidentBytes` cap.

## Claim under test

A hard resident-byte cap must not let asynchronous load-completion order override scheduler priority. Before this change, a farther/lower-priority tile could finish first, become resident, consume the entire cap and leave a nearer/higher-priority tile cached and budget-deferred indefinitely while both remained desired.

This is a scheduler correctness issue under an already-configured cap. It is **not** evidence for choosing any production cap value.

## Change

`TileStreamingScheduler` now performs deterministic priority-preserving resident preemption before activation when a configured `maxResidentBytes` would otherwise be exceeded:

- priority is the existing distance ordering with tile-id tie break;
- only strictly lower-priority resident tiles may be preempted;
- lower-priority residents are deactivated farthest-first until enough configured resident capacity exists;
- deactivation uses the normal injected renderer lifecycle adapter with reason `resident-budget-preempted`;
- successful preemptions increment `residentBudgetPreemptions`;
- a candidate whose own payload exceeds the entire cap is deferred without evicting useful resident state;
- the existing hard resident overcommit invariant remains unchanged.

No renderer backend logic, RuntimeVerificationBundle semantics, raw source networking, DTM1 seam logic or numeric production budget policy was added.

## Adversarial regressions

`engine/streaming/test_tile_scheduler_resident_priority.mjs` adds three focused cases:

1. **Out-of-order completion priority inversion:** a farther 100-byte tile is forced to complete and activate before a nearer 100-byte tile under a 100-byte cap. When the nearer tile completes, the farther tile must move resident → cached and the nearer tile must become resident without overcommit.
2. **Oversized candidate:** a 150-byte higher-priority tile under a 100-byte cap must be deferred without evicting an already useful 100-byte resident tile.
3. **Equal-distance determinism:** when two tiles are equidistant, the existing lexical tile-id tie break must also govern resident-budget preemption.

The new regression is wired into `.github/workflows/baseline.yml` alongside the existing scheduler suite.

## Evidence class

This change is designed for hosted Node/CI regression evidence. It does not claim browser GPU behavior, physical VRAM reclamation or mobile performance. Exact-real neighboring terrain remains blocked by FORGE's seam gate, so synthetic descriptors are intentionally used only to exercise scheduler lifecycle semantics.

## Acceptance

PASS requires the exact branch head to satisfy:

- Node syntax check for `tile_scheduler.mjs` and `test_tile_scheduler_resident_priority.mjs`;
- `resident budget priority regressions: PASS (3 cases)`;
- existing scheduler/retry/lifecycle/trace regressions remain green;
- baseline CI succeeds without resident-byte overcommit regressions.

Until exact-head CI is green, implementation is present but the proof remains pending final hosted validation.
