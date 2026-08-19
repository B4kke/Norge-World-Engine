# STRØM proof — concurrent resident-budget preemption

Date: 2026-08-19
Gate: `P0-STREAMING-01`
Evidence class: deterministic scheduler regression + hosted CI when exact-head run completes

## Claim under test

A hard `maxResidentBytes` contract is not safe if two higher-priority cached/load-complete candidates can both select the same resident incumbent while the injected async `deactivateTile()` callback is pending. The dangerous interleaving is:

1. incumbent is resident and consumes the full resident-byte cap;
2. candidate A starts budget preemption and awaits renderer-neutral deactivation;
3. candidate B reaches activation before A's callback resolves;
4. B must not select/deactivate the same incumbent again or reserve bytes as if capacity were already free.

SENTINEL correctly classified this case as NOT-PROVEN on the previous STRØM head.

## Implementation

`TileStreamingScheduler.#deactivate()` now transitions `resident -> deactivating` synchronously before awaiting the injected callback.

The accounting rule is intentionally conservative:

- `bytesResident` is **not** decremented while deactivation is pending;
- the tile is therefore unavailable as another resident-preemption victim;
- only successful callback completion moves bytes from resident to cached;
- callback failure restores `state = resident` and retains the original resident accounting;
- snapshots expose `deactivatingCount` separately while `bytesResident` continues to include the in-flight resource.

No renderer-specific semantics are added. `deactivateTile()` remains an injected renderer-neutral lifecycle boundary.

## Adversarial regression

`testConcurrentPreemptionDeactivatesIncumbentExactlyOnce()` establishes one 100-byte incumbent under `maxResidentBytes = 100`, then starts two 100-byte higher-priority candidates with `maxConcurrentLoads = 2`.

Both candidate loads complete in the same turn while incumbent deactivation is deliberately suspended. The regression requires the in-flight snapshot to show:

- incumbent state `deactivating`;
- `deactivatingCount = 1`;
- `bytesResident = 100`;
- `bytesActivating = 0`;
- `residentBudgetOvercommitBytes = 0`;
- exactly one `deactivateTile(incumbent, ..., reason=resident-budget-preempted)` call;
- exactly one competing activation deferred by the resident budget.

After releasing the callback it requires:

- exactly one successful resident-budget preemption;
- exactly one budget deferral;
- winner resident, competing candidate cached, incumbent cached;
- `bytesResident = 100`, `bytesActivating = 0`, `bytesCached = 200`;
- `residentBudgetOvercommitBytes = 0`;
- incumbent deactivation call count remains exactly one.

The existing deactivation-failure regression also requires the new transient state to roll back to `resident` on callback rejection.

## Authority / non-claims

This closes a scheduler correctness race only. It does not select a production resident-byte cap, GPU budget, cache size, LOD policy, worker pool, verification cache or renderer backend. It does not weaken `RuntimeVerificationBundle`, contact raw source APIs or define DTM1 seam semantics.

## CI

At proof creation, GitHub Actions for the code-bearing head had been registered but not yet completed. Final exact-head workflow status is recorded in PR #48 handoff rather than pre-claiming PASS here.
