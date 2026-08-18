# Runtime origin-shift invariant prototype

This prototype is stacked on the VEKTOR coordinate-precision experiment. It does **not** select a renderer, physics engine, ECS, whole-Norway CRS, tile format or origin-shift threshold.

## Question

Can dynamic runtime entities keep authoritative high-precision world state while renderer-local Float32 coordinates are regenerated whenever the render origin changes, without changing the fixed-tick world trajectory?

## Model under test

- authoritative positions: `Float64Array` world coordinates;
- authoritative velocities: `Float64Array` world-space values;
- fixed-tick integration mutates only world state;
- local render positions: derived `Float32Array(world - renderOrigin)`;
- an origin shift regenerates local positions from authoritative world coordinates;
- render origin never enters entity identity, world-state identity, source identity or tile identity.

The implementation stays under `prototypes/` because `engine/simulation/` is intentionally reserved until this requirement is proven and a production contract is justified.

## Run

```bash
node prototypes/runtime-origin-shift/test_origin_runtime.mjs
node prototypes/runtime-origin-shift/benchmark_origin_runtime.mjs
```

## Acceptance

The deterministic regression requires:

1. the same seeded fixed-tick simulation with and without repeated render-origin shifts produces exactly identical Float64 world positions;
2. velocities remain exactly identical;
3. origin shifts never mutate authoritative world state;
4. reconstructed world positions from local Float32 remain below 0.5 mm maximum error in the exercised ~4 km origin schedule;
5. invalid timestep/origin inputs fail closed.

CPU benchmark numbers are host-only directional evidence. Android/browser/GPU and real physics-engine behavior remain separate gates.
