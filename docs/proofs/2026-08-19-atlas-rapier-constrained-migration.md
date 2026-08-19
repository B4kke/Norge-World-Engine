# ATLAS proof — Rapier constrained physics-frame migration

Date: 2026-08-19  
Gate: `P0-COORDINATES-01`  
Role: ATLAS  
Evidence class: hosted Node + Rapier/WASM candidate

## Question

Can an active constrained body group change physics-local frame without changing authoritative world meaning, and can an illegal split across frames be rejected before solver state is mutated?

This probes the concrete solver boundary behind `nwe.physics-frame-topology-transition/0.1-candidate`. It is not a physics-engine selection and does not choose a whole-Norway coordinate, island-size or rebase threshold policy.

## Workload

`prototypes/atlas-rapier-physics/rapier_constrained_migration_probe.mjs` uses `@dimforge/rapier3d-compat@0.19.3` with:

- explicit world frame: horizontal `EPSG:25832`, vertical `NN2000`;
- two dynamic rigid bodies connected by one Rapier fixed impulse joint;
- zero-gravity free-flight so the coordinate translation is not confounded by a world-fixed floor/contact surface;
- 360 pre-migration ticks and 1,080 continuation ticks at 60 Hz;
- source physics frame `physics:island-a` and target frame `physics:island-b`;
- target anchor offset by `+1000.125 m east`, `-750.375 m north`;
- legal co-migration preflight through the topology contract before translating both bodies into target-local coordinates;
- adversarial split that tries to leave one constrained endpoint in frame A and move the other to frame B.

Rapier fixed joints are an appropriate stressor because the joint constrains both rigid bodies to preserve coincident local joint frames in world-space; the probe therefore exercises solver state, not only independent body translation.

## Hosted evidence

Exact code/workflow head `0e260b262e6529540688bb4045642cc41bd0cd9f`:

- `atlas-rapier-physics` run `32216267236` / #41: **SUCCESS**;
- evidence artifact `atlas-rapier-evidence`, SHA-256 digest `41ece7c9f421cc9468f7ac3733206da8fb9ea4c07fd10b59a4cb21acad57320d`;
- checkpoint snapshot SHA-256: `016b16790eeaeea759b16600a8a9a582db757ee3cb7347f6d68b3b573d6b71f4`.

### Legal constrained co-migration

Immediately after the translation-only frame migration, reconstructed world-state differed from the fixed-frame checkpoint by at most:

- position: `0.00003331041182818027 m` = **0.03331 mm**;
- linear velocity: **0 m/s**;
- rotation: `4.2146848510894035e-8 rad`;
- sleeping mismatch: **0**.

After 1,080 identical continuation ticks, migrated-vs-fixed divergence was:

- max world-position drift: `0.0011695095990235547 m` = **1.16951 mm**;
- max linear-velocity drift: `0.00006311910259986796 m/s` = **0.06312 mm/s**;
- max rotation drift: `0.0005418704299155257 rad` ≈ **0.03105°**;
- sleeping mismatch: **0**.

The final backend snapshots are not byte-identical. That is expected evidence that physics-local frame maintenance can influence solver evolution even when authoritative physical meaning is intended to remain unchanged.

### Illegal cross-frame split

The topology preflight attempted to place the two active fixed-joint endpoints in different physics frames. It failed closed with:

`CROSS_FRAME_CONSTRAINT`

The Rapier snapshot SHA-256 before and after rejection remained exactly:

`016b16790eeaeea759b16600a8a9a582db757ee3cb7347f6d68b3b573d6b71f4`

Therefore this probe demonstrates the intended integration ordering: validate topology first; mutate solver-local state only after the transition is accepted.

## What is now supported by evidence

- Physics-frame membership/topology is simulation/replay representation state, not geographic world truth.
- A complete constrained component can be migrated together under the candidate same-frame constraint rule.
- A translation-only co-migration is not numerically free in the tested Rapier/WASM workload: tiny immediate conversion error can grow into measurable solver divergence over subsequent ticks.
- A constrained split can be rejected before backend state changes when the contract is used as a mandatory preflight gate.
- Renderer origin remains unrelated to this authority boundary; no render-origin field participates in the probe.

## What is not proven

This does **not** prove:

- Rapier is the production physics backend;
- Float32 or any other physics precision policy is selected;
- a specific island extent, migration distance, rebase frequency or threshold is safe;
- 1.16951 mm is a universal upper bound;
- contact-rich constrained migration behaves the same as free-flight migration;
- cross-frame constraints can never be supported; they remain undefined until an explicit solver/coordinate bridge exists;
- browser/device/WASM behavior equals this hosted Node run;
- any final whole-Norway coordinate/indexing policy.

No decision is added to `docs/04-decisions.md`.

## Contract implication

The stable boundary should continue to treat authoritative entity world pose as world-frame state while physics-local frames, membership and topology transitions are explicit replay inputs. A backend island graph or renderer transform tree must not silently become authoritative membership. Frame migration must be ordered and validated before solver mutation, and replay must carry enough frame/topology history to reproduce the chosen solver schedule.

## Next

The next high-value adversarial gate is a contact-rich constrained component migration: include world-fixed collision/contact state, perform the same legal co-migration, and test whether the world-fixed geometry must migrate as part of the island representation or whether a separate static-world adapter is required. That boundary must be explicit before physics islands can move through streamed terrain without hidden coordinate assumptions.
