# STRØM proof — long-run retained admission starvation recovery

**Date:** 2026-08-19  
**Gate:** `P0-STREAMING-01`  
**Evidence class:** deterministic Node scheduler/resource-accounting regression + hosted CI when exact-head workflow completes. This is not Android, GPU/VRAM, real neighboring DTM1 terrain, or production budget evidence.

## Question

The merged mixed-size fairness proof establishes one blocked-large/small-fits cycle. The remaining adversarial question is whether repeated movement can accumulate starvation, stale admission state, reservation leakage or concurrency leakage before the larger tile becomes admissible.

## Scenario

`test_retained_admission_starvation.mjs` and `benchmark_retained_admission_starvation.mjs` compose the real `TileStreamingScheduler` pre-start admission hook with `createRetainedBudgetLifecycleAdapter()`.

Synthetic accounting only:
- retained cap: 250 B;
- incumbent: 150 B at E=0;
- large: 150 B at E=100;
- small: 100 B at E=90;
- active radius: 40 m;
- retain radius: 120 m;
- max concurrent loads: 2.

The path repeats 12 pressure/reset cycles:
1. E=100: `large` is desired but cannot fit; `small` fits and is resident; `large` remains queued without consuming an active-load slot.
2. E=0: `large` leaves active interest and must return to idle; incumbent is resident again.

After 12 blocked/cancelled cycles, the path returns to E=100 once more, then moves to E=121. At E=121 the incumbent crosses the retain boundary and is disposed while `large` remains inside the active radius, making the larger tile genuinely admissible.

## Acceptance

Across every blocked cycle:
- `large` never materializes;
- `large` is queued only while desired and returns to idle when interest is removed;
- active loads return to 0;
- queue depth returns to 0 after reset;
- committed + reserved retained accounting never exceeds 250 B;
- retained overcommit remains 0.

At final capacity release:
- incumbent disposal is observed;
- `large` materializes exactly once and becomes resident on the first scheduler update where it is admissible;
- active loads and queue depth return to 0;
- reserved bytes return to 0;
- retained overcommit remains 0.

## Claim boundary

A green run proves bounded deterministic progress for this repeated defer/cancel/reprioritize case and shows no retained-accounting or concurrency leakage in the tested path. It does not prove global fairness for arbitrary scheduling graphs, select a production memory cap, prove physical RAM/VRAM reclamation, choose worker/cache/LOD policy, or promote neighboring terrain.

No raw source API calls are introduced. RuntimeVerificationBundle semantics are untouched. No DTM1 seam rule or renderer-specific streaming-core logic is added.

## Next

If hosted CI is green, use the resulting deferral count and bounded recovery as the baseline before adding any fairness state. Only a concrete failing adversarial path should justify additional scheduler policy/state; otherwise keep pre-start admission simple and move to automatically measured multi-tile resource-pressure experiments using compiler-promoted artifacts when available.
