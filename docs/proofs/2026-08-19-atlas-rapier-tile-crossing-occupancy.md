# ATLAS proof — Rapier tile-crossing solver occupancy

Date: 2026-08-19  
Gate: `P0-COORDINATES-01`  
Role: ATLAS  
Evidence class: hosted Node + Rapier/WASM candidate

## Question

Can actual solver collision events drive the existing static-collision occupancy contract strongly enough that renderer/cache interest cannot silently evict terrain collision while a body is still using it, and can the collision be released immediately after the solver reports contact separation?

This advances the boundary between authoritative static world/tile identity, derived physics-local collision state and runtime streaming. It does not select a physics backend, terrain-collider format, residency budget, rebase threshold or whole-Norway coordinate policy.

## Workload

`prototypes/atlas-rapier-physics/rapier_tile_crossing_occupancy_probe.mjs` uses `@dimforge/rapier3d-compat@0.19.3` with:

- explicit world-frame identity with horizontal CRS `EPSG:25832` and vertical datum `NN2000` represented separately;
- one dynamic sphere moving across two adjacent static floor colliders representing terrain tiles A and B;
- Rapier collision-event delivery enabled on the involved colliders;
- an `EventQueue` drained after each completed physics step;
- the actual active collision-pair set converted into `nwe.static-collision-occupancy-snapshot/0.1-candidate`;
- occupancy-derived dependencies applied to `nwe.static-collision-lifecycle-event/0.1-candidate` before the next physics step.

No render origin, renderer transform or cache state participates in the occupancy authority path.

## Hosted evidence

Exact code/workflow head `c007187bd02dad3cb52de394a734ef6b881c2bd1` passed:

- `atlas-rapier-physics` run `32238479536` / #77: **SUCCESS**;
- repository `baseline` run `32238479375` / #1530: **SUCCESS**;
- uploaded `atlas-rapier-evidence` artifact id `9359839849`, ZIP SHA-256 `3361ecadb491f90929880e666b0c4ae0fbff54dfbeb97c2e0396e331ba168812`.

The observed event/lifecycle sequence was:

1. tick `0`: Rapier reports collision start with tile A;
2. tick `30`: renderer interest is treated as removed while occupancy still pins tile A; an eviction attempt fails closed with `COLLISION_IN_USE`;
3. tick `119`: Rapier reports collision start with adjacent tile B while A is still active;
4. tick `121`: Rapier reports collision stop with tile A;
5. the occupancy snapshot for that same completed step clears tile A's dependency set;
6. tick `121`: tile A collision can then be evicted, while tile B remains resident.

`staleEventOrderingDetected` remained `false`. The transition order was therefore A-start -> B-start -> A-stop, giving a brief overlap at the tile boundary rather than a missing-collision gap.

The same focused run retained all earlier ATLAS contract and solver probes green, including maintenance events, multi-island batches, membership, topology, static collision binding/lifecycle, scheduler collision guard and occupancy regressions.

## What this proves

For this hosted Rapier/WASM workload, real backend collision-transition events can drive the candidate occupancy snapshot instead of a manually invented dependency list.

Renderer-interest removal is insufficient authority to remove physics collision: tile A remained protected after presentation interest was removed because the solver-derived occupancy still referenced it. Once the backend reported the contact stop and the completed-step occupancy snapshot no longer referenced A, lifecycle eviction became legal before the next physics step.

This preserves the intended authority split:

- static artifact identity, tile identity and world placement are world/tile truth;
- physics-local collider transforms and contact occupancy are derived simulation state;
- renderer/cache interest is scheduling/presentation state and cannot override active solver dependencies.

## Claim calibration

This proof is intentionally narrow. It does **not** prove:

- Rapier is the production physics backend;
- a collision event is sufficient for every future contact/manifold/CCD policy;
- real DTM terrain collider behavior equals two adjacent flat cuboids;
- STRØM cache pressure and the Rapier event source have yet been exercised together in the same runtime probe;
- physics-frame epoch maintenance during the crossing is safe;
- terrain artifact replacement during active contact is safe;
- a collision residency budget or eviction grace period;
- browser/device-specific solver behavior;
- any final whole-Norway coordinate/index policy.

`docs/04-decisions.md` remains unchanged.

## Next

The next high-value adversarial gate is one atomic ordering test that combines **tile crossing + physics-frame epoch maintenance + terrain artifact replacement while contact is active**. The accepted path must either rebind the exact replacement collision into the post-maintenance physics frame with continuous occupancy before the next solver step, or fail closed before solver/lifecycle state mutates. This should be exercised together with the existing STRØM scheduler guard rather than deriving a policy from this single flat-tile probe.
