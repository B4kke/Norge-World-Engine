# 2026-08-18 — VEKTOR runtime origin-shift invariants

## Scope

Renderer-independent synthetic runtime experiment only. This work does not modify DTM1 acquisition/compiler code, tile identity, world streaming, viewer batching, worker code, source/artifact identity, CRS/datum contracts or `engine/simulation`.

It is stacked on the separate coordinate-precision proof and tests the next narrower question: whether render-origin changes can be isolated from authoritative dynamic entity state.

## Model

- `Float64Array` positions are authoritative world state.
- `Float64Array` velocities are authoritative world-space dynamic state.
- one deterministic fixed-step integrator updates world positions only.
- `Float32Array` local positions are disposable renderer derivatives computed as `world - renderOrigin`.
- render-origin shifts regenerate local positions from world state instead of mutating world coordinates.
- temporal displacement across an origin shift must either compensate the origin delta or treat the shift as a temporal-history discontinuity; raw local-frame deltas are not world motion.

This is not an ECS or physics-engine selection.

## Local regression evidence

Initial authoring environment: Node `v22.16.0`, V8 `12.4.254.21-node.26`, Linux x64.

Deterministic test:

- entities: **2,048**;
- fixed ticks: **3,600** at `1/60 s`;
- render-origin shifts: **29**;
- origin schedule wanders by up to approximately **4 km** horizontally and **50 m** vertically;
- shifted-origin run and fixed-origin run end with **exactly identical Float64 world positions**;
- velocities remain **exactly identical**;
- maximum reconstructed world error from derived Float32 locals during the run: **0.244141 mm**;
- explicit origin shift leaves authoritative positions/velocities byte-for-value unchanged;
- invalid zero timestep and non-finite origin fail closed.

Temporal-motion regression:

- one entity moves physically `+0.2 m / -0.05 m / +0.00833 m` during one 60 Hz tick;
- the render origin simultaneously shifts `+3000 m / -3000 m / +30 m`;
- naïvely subtracting consecutive local Float32 positions reports approximately `-2999.8 m / +2999.95 m / -29.99 m`, equivalent to absurd ~180 km/s apparent horizontal motion;
- reconstructing frame positions with each frame's origin recovers the true world displacement with maximum error **0.04883 mm**.

Therefore temporal systems such as motion vectors, interpolation, trail/history logic or velocity diagnostics must not interpret raw local-position deltas across an origin epoch change as physical motion.

## Local host CPU direction

The benchmark separately measures Float64 fixed-tick integration, normal local derivation, and full local re-derivation after a render-origin shift.

Initial local Node/V8 observation:

| Entities | Float64 integrate median | Float32 local derive median | Origin-shift rederive median | Max reconstructed error |
| ---: | ---: | ---: | ---: | ---: |
| 1k | ~0.0023 ms | ~0.0021 ms | ~0.0021 ms | ~0.122 mm |
| 10k | ~0.0212 ms | ~0.0180 ms | ~0.0180 ms | ~0.122 mm |
| 100k | ~0.2097 ms | ~0.1783 ms | ~0.1783 ms | ~0.122 mm |

These timings are host-only directional evidence. They are not Android/browser/GPU/main-thread or physics-engine acceptance numbers.

## What this proves

1. A render-origin schedule can be made orthogonal to authoritative dynamic world state.
2. Fixed-tick trajectory determinism does not require the render origin to participate in simulation state.
3. Disposable Float32 local positions can be regenerated after origin shifts while keeping sub-mm reconstruction error at the exercised local magnitudes.
4. Raw local-frame displacement is invalid across an origin change unless the origin delta is incorporated; otherwise an origin shift becomes a false velocity spike.
5. This supports a future contract where simulation/world coordinates remain high precision and renderer coordinates are derived views with an explicit origin epoch/discontinuity boundary.

## What remains open

- production entity/ECS representation;
- actual collision/physics engine precision and world-shift boundary;
- whether physics uses Float64 world coordinates directly or a separate local physics island;
- origin anchor and trigger threshold;
- exact renderer policy for temporal history reset vs compensated motion vectors;
- multi-player/network authoritative state implications;
- Android/browser cost and visible-frame hitch behavior when many live render objects are rebound.

No decision is added to `docs/04-decisions.md` from this prototype alone.
