# 2026-08-18 — ATLAS physics-local collision precision counterexample

## Scope

This proof advances `P0-COORDINATES-01` by testing one concrete physics-local workload through the candidate world/physics boundary. It does **not** select a physics engine, precision, rebase threshold, island extent, integrator, whole-Norway CRS/index or network policy.

The question is deliberately adversarial: does moving a dynamic body into an anchor-relative Float32 physics representation remain independent from the non-physical schedule of physics-frame rebases?

## Prototype

`prototypes/atlas-physics-local-collision/physics_local_collision_probe.mjs` consumes `engine/world/physics_state_contract.mjs` and runs a deterministic local-space body/contact workload:

- authoritative initial position at Nannestad-scale projected coordinates in an explicit `EPSG:25832` + `NN2000` `WorldFrame`;
- physics-local backend state in either `Float64Array` or `Float32Array`;
- 3,600 steps at 60 Hz;
- world-axis horizontal velocity plus vertical gravity;
- semi-implicit Euler integration;
- one horizontal world-height contact plane, radius 0.5 m and restitution 0.35;
- fixed physics frame versus a schedule with three translation-only physics-frame rebases;
- each rebase reconstructs through authoritative Float64 world coordinates before the local backend representation is quantized again.

This is a deterministic boundary probe, not a production rigid-body solver.

## Hosted result

GitHub Actions baseline run `32188468598` / #878 completed **SUCCESS** with the probe gated inside `World coordinate contract regressions` on branch head `f9d824cf0a42735ea98b9f3e9040b0f9b31349b9`.

Node 22.23.2 reported:

- status: `ATLAS_PHYSICS_LOCAL_COLLISION_PROBE_PASS_WITH_FLOAT32_COUNTEREXAMPLE`;
- 3,600 steps;
- 3 physics-frame rebases in the rebased schedule;
- 3,362 plane contacts in all controlled candidates;
- Float64-local fixed-vs-rebased final position drift: **0 m**;
- Float64-local fixed-vs-rebased final velocity drift: **0 m/s**;
- Float32-local fixed-vs-rebased final position drift: **0.010345458984375 m** (~10.35 mm);
- Float32-local fixed-vs-rebased final velocity drift: **0 m/s**;
- initial absolute projected Float32 representation error: **0.04321100004017353 m** (~43.21 mm);
- initial anchor-relative Float32 reconstruction error: **0.0000018905848264694214 m** (~0.00189 mm);
- max pre-resolve penetration: Float64 fixed **0.1622190000000182 m**, Float32 fixed **0.1622084677219391 m**.

The full repository baseline also passed compiler tests (`60 passed`), world/network/physics contract regressions, provenance reconstruction, streaming scheduler, terrain worker/tile loader, viewer artifact boundary and Cesium baseline build in the same run.

## What this proves

**FACT:** anchor-relative Float32 massively reduces the *initial representation error* versus casting large EPSG:25832-scale absolute coordinates directly to Float32 in this Nannestad-scale sample.

**FACT:** that improvement does not imply rebase-schedule invariance. In the controlled 3,600-step contact workload, Float32-local state ended approximately 10.35 mm apart depending only on whether three translation-only physics rebases occurred. The Float64-local candidate ended exactly identical in the same structural run.

**FACT:** the rebase schedule did not manufacture velocity in this test; fixed and rebased Float32 candidates ended with zero measured velocity delta and the same contact count.

**INFERENCE:** a future Float32 physics backend may need stricter local-extent/rebase rules, state reconstruction strategy, mixed precision, deterministic quantization rules or another mitigation if authoritative/replay outcomes must be invariant to physics-frame maintenance. The present probe cannot select which mitigation is correct.

## Claim calibration

- `physicsPrecisionPolicy`: **OPEN**
- `physicsRebaseThresholdPolicy`: **OPEN**
- `wholeNorwayCoordinatePolicy`: **OPEN**
- `renderOriginAuthority`: **false**
- `physicsLocalAuthority`: **false**
- renderer-local Float32 success must **not** be generalized into a physics-local Float32 policy by analogy.

This is synthetic hosted Node evidence. It is not actual Rapier/Jolt/Bullet/PhysX/Unreal evidence, not browser/WASM evidence, not Android/device evidence and not a whole-Norway benchmark.

## Next gate

The next high-value ATLAS experiment is a backend adapter against one real candidate physics runtime, preferably one that can expose both Float32/WASM and/or higher-precision behavior without binding authoritative state to the engine. Re-run the same fixed-vs-rebased path with controlled local extents and measure world-state drift, collision/contact divergence and CPU cost. Do not choose a production precision or rebase threshold until representative runtime/device evidence exists.
