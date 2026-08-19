# `engine/world` — candidate world-coordinate contract

This module owns the boundary between authoritative world state and disposable local presentation/subsystem frames. It is intentionally renderer-, streaming-, physics- and network-library independent.

## Contract v0.1 candidate

`WorldFrame` names the coordinate authority. Horizontal CRS and vertical datum are separate mandatory fields. The current v0.1 arithmetic model is `projected-cartesian-height`: easting, northing and datum-qualified height are metre-valued JavaScript Numbers (IEEE-754 Float64). Nannestad may instantiate this with `EPSG:25832` + `NN2000`; that does **not** make EPSG:25832 a whole-Norway policy.

`WorldPosition` is authoritative state and always carries `worldFrameId`. Renderer-local positions are derived as `Float32Array(3)` only after Float64 subtraction against a `RenderOrigin.anchorWorld`. The renderer may retain local coordinates, GPU buffers and an `originEpoch` for presentation/history, but must not write those values back as world truth.

`RenderOrigin` contains an explicit `originSeriesId`, world-frame anchor and monotonic safe-integer epoch. The pair `(originSeriesId, epoch)` identifies the local frame, so samples from another camera/session cannot alias merely because the numeric epoch matches. The policy that chooses the anchor or shift threshold is deliberately outside this module. A shift increments the epoch and returns the Float64 world-space origin delta. Raw local deltas across different epochs are rejected; temporal systems either reconstruct/compensate using the matching historical origins or reset their history.

`TileFrame` gives a runtime tile identity a high-precision anchor in the same `WorldFrame`. Tile-local coordinates are offsets from that anchor. `tileLocalToRenderLocal()` combines tile and render anchors in Float64 before the single Float32 storage conversion, so large absolute projected coordinates never need to pass through Float32 world space.

`SubsystemLocalFrame` is the generic future boundary for physics or other local engines. Its anchor/epoch is independent of `RenderOrigin`; changing presentation origin cannot move physics/world state. Authoritative serialization uses `nwe.authoritative-world-snapshot/0.1`, carries the explicit `WorldFrame`, and excludes render origin/epoch entirely.

## Candidate network spatial boundary

`network_state_contract.mjs` adds a deliberately separate, versioned network boundary. A `NetworkSpatialFrame` has its own `networkFrameId`, epoch, world-space anchor and explicit `positionQuantumMeters`. Network positions are integer offsets from that anchor and always decode back into the authoritative `WorldFrame`; render-origin state is neither accepted nor serialized.

The quantum is configuration carried by the candidate snapshot, **not a selected production policy**. The current regression exercises `0.001 m` only to prove bounded round-trip behavior and fail-closed range handling. Changing a network-frame anchor/epoch changes wire integers but must not be interpreted as physical movement, just as render-origin rebasing is not physical movement.

The candidate wire schema is `nwe.network-spatial-snapshot/0.1-candidate`. It records horizontal CRS and vertical datum separately, rejects unknown presentation fields, rejects stale/foreign network epochs and refuses quantized values outside JavaScript's safe-integer range. No renderer transform, render-origin epoch or GPU-local coordinate is network authority.

## Candidate physics/simulation spatial boundary

`physics_state_contract.mjs` specializes the generic subsystem-local frame for physics without making physics-local coordinates authoritative. `PhysicsSpatialFrame` has its own `physicsFrameId`, monotonic epoch and high-precision world anchor. Bodies carry Float64 local positions only while they belong to one exact physics frame/epoch; stale bodies are rejected instead of being reinterpreted after a rebase.

Velocity remains expressed along the authoritative world-frame axes in metres per second, so a pure translation rebase changes local position but cannot create false velocity. `reframePhysicsBody()` reconstructs authoritative world position from the old physics frame before deriving the new local position. A render-origin shift is unrelated and cannot mutate physics state.

`nwe.simulation-spatial-snapshot/0.1-candidate` deliberately serializes authoritative world position + velocity and excludes both render-origin and physics-local frame state. This makes snapshot authority independent from disposable local-frame storage. It is a boundary experiment, not a selected physics engine, integration method, precision, island size or rebase threshold.

## Physics frame maintenance as replay input

`physics_frame_event_contract.mjs` adds `nwe.physics-frame-maintenance-event/0.1-candidate` for the narrower case where a physics backend is sensitive to local-frame maintenance schedule. The event carries simulation tick, authoritative `worldFrameId`, independent `physicsFrameId`, consecutive `fromEpoch -> toEpoch`, authoritative from/to world anchors, their derived world-space delta and a reason.

The event is **not physical movement** and it is not render-origin state. It exists so a deterministic replay path does not have to infer hidden backend-frame transitions. Deserialization/application fails closed on stale epochs, foreign frame series/world frames, tampered anchor deltas, unsupported fields or invalid event ordering. Multiple physics islands may therefore maintain independent epoch sequences while sharing the same authoritative world frame.

This does not make backend snapshots authoritative. The contact-rich Rapier/WASM probe shows why the distinction matters: same-checkpoint/same-frame-schedule replay can be exactly repeatable, while a translation-only physics-frame rebase before otherwise identical continuation can alter later solver results. Until a backend-specific invariant rebase mechanism is proven, replay must treat the frame-maintenance schedule as simulation-relevant input or rebuild backend state from authoritative world state at defined boundaries.

`physics_frame_batch_contract.mjs` adds `nwe.physics-frame-maintenance-batch/0.1-candidate` so multiple island/frame maintenance events on one simulation tick do not inherit accidental producer array order as replay semantics. A batch binds one tick and one authoritative world frame, canonicalizes events by `physicsFrameId` and epoch transition, rejects duplicate/gapped same-frame transitions, and applies against explicitly supplied current frame states. Current-frame input order is non-semantic and output frame order is canonicalized.

The batch is still replay metadata rather than world truth: authoritative positions remain world-frame Float64 state, while physics-local anchors/epochs describe how a backend-local representation was maintained. Island split/merge/migration semantics remain open and must become explicit if later simulation allows bodies or constraints to cross physics-frame ownership.

## Physics-local collision precision probe

`prototypes/atlas-physics-local-collision/` consumes the candidate physics boundary with a concrete deterministic moving-body/contact workload: gravity, semi-implicit Euler integration and a horizontal plane contact. It runs the same world initial state under a fixed physics frame and under a three-rebase schedule, with both Float64-local and Float32-local backend state.

The probe exists to falsify unsafe assumptions, not to select an engine. It treats floor height as datum-qualified world height and derives only the local plane coordinate from the active `PhysicsSpatialFrame`. Rebase reconstructs through authoritative Float64 world coordinates before the backend representation is quantized again.

The important candidate invariant is stronger than “local Float32 is more precise than absolute Float32”: **a disposable local backend representation must not silently make authoritative outcomes depend on an otherwise non-physical rebase schedule**. The structural probe therefore reports both initial representation error and final fixed-vs-rebased world-state drift. A measurable Float32 counterexample keeps physics precision/rebase policy open rather than turning the existing render-local Float32 success into a physics policy by analogy.

## Explicit non-decisions

- No whole-Norway horizontal CRS/indexing strategy is selected.
- No render-origin anchor or shift threshold is selected.
- No physics engine, physics precision, island size, integration method or rebasing threshold/frequency is selected.
- No backend-local physics snapshot/persistence policy is selected.
- No production networking authority, replication topology, prediction model, compression or quantization is selected.
- No tile size or tile-local storage precision is selected by this module.
- `projected-cartesian-height` is the candidate v0.1 arithmetic model exercised by current Prototype-0 evidence; replacing/expanding it requires a versioned contract and representative measurements.

## Regression

```bash
node --check engine/world/world_contract.mjs
node --check engine/world/test_world_contract.mjs
node engine/world/test_world_contract.mjs
node --check engine/world/network_state_contract.mjs
node --check engine/world/test_network_state_contract.mjs
node engine/world/test_network_state_contract.mjs
node --check engine/world/physics_state_contract.mjs
node --check engine/world/test_physics_state_contract.mjs
node engine/world/test_physics_state_contract.mjs
node --check engine/world/physics_frame_event_contract.mjs
node --check engine/world/test_physics_frame_event_contract.mjs
node engine/world/test_physics_frame_event_contract.mjs
node --check engine/world/physics_frame_batch_contract.mjs
node --check engine/world/test_physics_frame_batch_contract.mjs
node engine/world/test_physics_frame_batch_contract.mjs
node --check prototypes/atlas-physics-local-collision/physics_local_collision_probe.mjs
node --check prototypes/atlas-physics-local-collision/test_physics_local_collision_probe.mjs
node prototypes/atlas-physics-local-collision/test_physics_local_collision_probe.mjs
python -m json.tool engine/world/schemas/authoritative-world-snapshot-v0.1.schema.json >/dev/null
python -m json.tool engine/world/schemas/network-spatial-snapshot-v0.1.schema.json >/dev/null
python -m json.tool engine/world/schemas/simulation-spatial-snapshot-v0.1.schema.json >/dev/null
python -m json.tool engine/world/schemas/physics-frame-maintenance-event-v0.1.schema.json >/dev/null
python -m json.tool engine/world/schemas/physics-frame-maintenance-batch-v0.1.schema.json >/dev/null
```

The world adversarial suite covers large absolute coordinates, origin shift mid-tick, temporal delta across epoch boundaries, historical origin retention, tile-boundary crossing, entity crossing the render anchor, authoritative serialization/replay and a render-independent subsystem adapter. The network suite adds deterministic wire serialization, explicit bounded quantization, network-frame rebasing, stale/foreign epoch rejection, world-frame mismatch rejection, safe-integer overflow rejection and explicit refusal of render-origin leakage. The physics suite adds large-coordinate reconstruction, 1,000 unrelated render-origin shifts, physics rebase mid-tick, stale-epoch rejection, anchor crossing, byte-identical authoritative snapshots across rebase schedules, replay under a different physics anchor and foreign-world rejection. The maintenance-event suite adds deterministic event serialization, exact epoch progression, stale/foreign frame rejection, tamper detection, presentation-field rejection, ordered replay and multiple-island sequencing. The maintenance-batch suite adds same-tick canonical ordering across island permutations, deterministic application independent of current-frame array order, consecutive same-island chains and fail-closed duplicate/gap/tick/world/presentation ambiguity. The collision and Rapier probes provide concrete contact workloads that compare fixed and rebased physics-frame schedules under candidate backend state.
