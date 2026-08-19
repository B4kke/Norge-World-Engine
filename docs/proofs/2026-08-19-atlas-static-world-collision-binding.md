# ATLAS proof — static world collision binding across physics-frame maintenance

Date: 2026-08-19  
Gate: `P0-COORDINATES-01`  
Role: ATLAS  
Evidence class: contract regressions + hosted Node/Rapier WASM candidate

## Question

When a physics-local frame changes while dynamic bodies are in contact with streamed/static world geometry, what must remain authoritative and what must be re-derived?

The dangerous hidden assumption is that a physics-frame migration can translate only dynamic bodies while leaving static terrain/collision at its old solver-local coordinates. That would preserve neither contact geometry nor world meaning.

## Candidate boundary

`engine/world/static_collision_contract.mjs` introduces `nwe.static-world-collision-binding/0.1-candidate`.

A static collision binding names:

- collision identity;
- exact compiled artifact SHA-256;
- runtime `tileId`;
- authoritative `WorldFrame` identity;
- explicit horizontal CRS and vertical datum as separate fields;
- exact `(physicsFrameId, epoch)`;
- high-precision tile and physics world anchors.

The solver-local collider translation is derived from those world/tile anchors. It is not authoritative world state and it is not render-origin state.

## Adversarial contract regressions

Exact code/workflow head `8d34707b65520abb29b130dd133328f63c26716c` passed 8/8 static-collision cases in `atlas-rapier-physics` run `32219770880` (#49):

1. horizontal CRS and vertical datum remain explicit and separate;
2. the same tile-local collision point reconstructs the exact same world point across physics epochs;
3. stale static-collider epoch fails closed;
4. foreign runtime tile identity fails closed;
5. foreign world frame fails closed;
6. invalid artifact SHA-256 fails closed;
7. render-origin/presentation leakage fails closed;
8. missing/conflated vertical-datum identity fails closed.

The same exact code/workflow head passed full repository baseline run `32219770891` (#1335).

## Rapier/WASM contact probe

`prototypes/atlas-rapier-physics/rapier_static_world_migration_probe.mjs` uses `@dimforge/rapier3d-compat@0.19.3` with:

- world frame: `EPSG:25832` horizontal + `NN2000` vertical;
- accepted Nannestad terrain artifact identity `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`;
- runtime tile `nannestad:618000:6690000:1000`;
- a fixed static collision floor derived from the tile/world frame;
- two dynamic rigid bodies connected by a fixed impulse joint;
- gravity, friction and active contact;
- 600 pre-maintenance ticks + 360 continuation ticks at 60 Hz;
- physics-frame maintenance of `+1000.125 m` east and `-750.375 m` north, epoch `0 -> 1`.

Three paths are compared from the same checkpoint:

1. fixed-frame control;
2. dynamic bodies translated into the new physics frame **and static collision rebound from authoritative tile/world coordinates**;
3. adversarial invalid integration: dynamic bodies translated but static collision deliberately left in its old solver-local coordinates.

The static collision world anchor reconstructed from epoch 0 and epoch 1 bindings differed by exactly **0 m**.

### Correct dynamic + static rebind

After the 360-tick continuation, compared with the fixed-frame control:

- max world-position drift: `0.00008629274983957477 m` = **0.08629 mm**;
- max linear-velocity drift: `0.000031958956834700015 m/s` = **0.03196 mm/s**;
- max rotation drift: `0.00004089884227779234 rad` ≈ **0.00234°**.

This is not zero, so the tested Rapier/WASM frame maintenance is still not numerically free. It does show that rebuilding the static collision representation from the same world truth keeps the physical scene approximately invariant in this workload.

### Adversarial dynamics-only migration

When static collision is intentionally left in the previous solver-local frame:

- max world-position drift: **176.701818 m**;
- max linear-velocity drift: **58.859535 m/s**.

This enormous divergence is an intentionally broken integration case. It must **not** be read as expected production drift. Its purpose is to falsify the assumption that static collision may remain bound to a stale physics frame while dynamics move to a new one.

## Evidence artifact

The hosted ATLAS run uploaded `atlas-rapier-evidence`:

- run: `32219770880`;
- artifact id: `9353539614`;
- uploaded ZIP SHA-256: `3c87311f3016f6a8ddcf63ebd07750b40037f9638a8bf7e58483ea2e265c2aec`;
- retention: 7 days.

## Contract implication

The stable boundary should treat streamed/static geometry identity and placement as world/tile-frame truth while treating its physics-local collider pose as derived representation state.

A physics-frame epoch change that affects bodies contacting static world geometry must therefore do one of the following before simulation continues:

- re-derive/rebind the required static collision representation from authoritative world/tile coordinates into the new physics frame; or
- use a backend-native origin-shift mechanism that is separately proven to preserve the same world/contact invariants.

A renderer transform tree cannot supply this authority. Render-origin epochs are intentionally rejected by the binding contract.

## Claim calibration

**Proven in this evidence class:** the candidate binding is fail-closed on stale/mismatched authority metadata; static world placement can be reconstructed exactly across physics epochs; and leaving collision in a stale solver-local frame is semantically invalid and causes catastrophic divergence in the tested contact workload.

**Observed, not production-bounded:** correct rebind produced ~0.086 mm position drift after six seconds in this one Rapier/WASM workload.

**Not proven / still open:**

- production physics backend or precision;
- physics-island extent or rebase threshold/frequency;
- terrain collider representation (heightfield, trimesh, compound, etc.);
- static collision streaming/residency and handoff policy;
- cost of rebuilding/rebinding large terrain collision sets;
- browser/device-specific solver behavior;
- whole-Norway coordinate/indexing policy.

No final coordinate/physics policy is added to `docs/04-decisions.md`.

## Next

The next high-value gate is **streaming-aware static collision lifecycle**: define and adversarially test what happens when a verified terrain tile is loaded/unloaded or replaced while a physics island is active, including ordering against physics-frame epoch maintenance. Collision residency must fail closed rather than silently allowing a body to interact with stale or missing world geometry.
