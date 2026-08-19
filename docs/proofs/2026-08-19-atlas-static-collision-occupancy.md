# ATLAS static collision occupancy boundary — 2026-08-19

## Gate

Advance `P0-COORDINATES-01` by removing the hidden assumption that static-collision pinning is maintained manually or inferred from renderer/cache residency.

## Candidate contract

`nwe.static-collision-occupancy-snapshot/0.1-candidate` is an `after-physics-step` observation of which authoritative simulation entities are touching which resident static-world collision artifacts.

The snapshot carries:
- authoritative simulation tick;
- world-frame identity;
- exact physics frame + epoch;
- entity ID;
- collision ID;
- runtime tile ID;
- exact artifact SHA-256.

It deliberately does not carry render origin, renderer transforms, cache state, backend island IDs or local Float32 coordinates.

`deriveStaticCollisionDependencies(...)` validates the snapshot against the current collision lifecycle state and produces canonical per-collision dependency sets. `createStaticCollisionStreamingGuard(...).syncDependenciesFromOccupancy(...)` can then commit those sets into the existing lifecycle boundary before the next disposal decision.

## Adversarial regressions

The focused suite covers 11 cases:
1. producer contact order canonicalizes to identical dependency state;
2. the streaming guard updates lifecycle pins from occupancy rather than a manually supplied entity list;
3. zero-contact resident collisions derive empty dependency sets;
4. duplicate entity/collision pairs fail closed;
5. stale completed-tick observations fail closed;
6. stale physics epoch fails closed;
7. unknown/non-resident collision references fail closed;
8. tile identity mismatch fails closed;
9. artifact replacement race/mismatch fails closed;
10. render/presentation leakage fails closed;
11. foreign world frame fails closed.

## Interpretation

Solver contact/occupancy is simulation-derived evidence used to protect static collision lifecycle. It is not geographic world truth. Static artifact identity and placement remain world/tile truth; occupancy only determines whether a resident collision is currently required by simulation entities.

This closes one hidden boundary from the prior scheduler guard: renderer deactivation/cache eligibility cannot release physics collision, and callers no longer need to invent `dependentEntityIds` manually when a solver occupancy snapshot is available.

## Non-decisions

This does not choose a physics backend, contact persistence policy, broadphase strategy, collision residency budget, terrain collider representation, physics island extent, rebase threshold or whole-Norway coordinate/index policy. A single synthetic contract test is not evidence for those policies.

`docs/04-decisions.md` remains unchanged.

## Next

Drive this candidate from actual Rapier contact/intersection callbacks in a two-tile crossing probe, then adversarially remove renderer interest from the first tile while the body is still contacting it. Collision eviction must remain blocked until the solver-derived occupancy releases that tile.
