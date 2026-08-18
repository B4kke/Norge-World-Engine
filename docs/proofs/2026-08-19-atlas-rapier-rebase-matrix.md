# ATLAS proof — Rapier rebase extent/frequency matrix

Date: 2026-08-19

## Scope

Advances `P0-COORDINATES-01` by testing whether translation-only maintenance of a physics-local Float32 frame can be reduced to a simple rule based on local extent or rebase frequency. This does not select Rapier, Float32 physics, a physics-island size, a rebase threshold/frequency, a render-origin policy or a whole-Norway coordinate policy.

## Runtime and workload

- `@dimforge/rapier3d-compat@0.19.3`, hosted Node 22 / WASM candidate.
- Horizontal CRS `EPSG:25832`; vertical datum `NN2000` remains explicit and separate.
- 3,600 steps at 60 Hz; one dynamic sphere, fixed floor, gravity, CCD and zero friction.
- Fixed-frame control plus 12 candidates: rebase intervals 5/15/30 s and anchor offsets 0/100/500/1,500 m.
- Authoritative world position is reconstructed through the old physics frame before every translation-only rebase. Render-origin state is not consumed.

## Hosted evidence

Exact branch head `733d329cb0ed40de9798601e26e9fb2cad40099c`:

- `atlas-rapier-physics` run `32197815958` / #8: **SUCCESS**.
- evidence artifact `atlas-rapier-matrix`, artifact id `9346448155`, SHA-256 `be4303c9bf5ef3d27cd4988c3dede8f4ab57ba0985864df6da27bd5f2d6c2a13`.
- absolute projected Float32 representation error: **12.44 mm**.
- anchor-relative Float32 reconstruction error: **0.0133 mm**.

| Interval | Anchor offset | Rebases | Max local extent | Final position drift vs fixed | Velocity drift |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 s | 0 m | 11 | 481.46 m | 52.31 mm | 0 m/s |
| 5 s | 100 m | 11 | 481.46 m | 103.58 mm | 0 m/s |
| 5 s | 500 m | 11 | 558.89 m | 76.03 mm | 0 m/s |
| 5 s | 1,500 m | 11 | 1,677.42 m | 852.06 mm | 0 m/s |
| 15 s | 0 m | 3 | 547.76 m | 58.49 mm | 0 m/s |
| 15 s | 100 m | 3 | 547.76 m | 55.81 mm | 0 m/s |
| 15 s | 500 m | 3 | 558.88 m | 57.72 mm | 0 m/s |
| 15 s | 1,500 m | 3 | 1,677.22 m | 695.68 mm | 0 m/s |
| 30 s | 0 m | 1 | 651.50 m | 24.34 mm | 0 m/s |
| 30 s | 100 m | 1 | 651.50 m | 38.96 mm | 0 m/s |
| 30 s | 500 m | 1 | 651.50 m | 35.75 mm | 0 m/s |
| 30 s | 1,500 m | 1 | 1,676.90 m | 462.91 mm | 0 m/s |

Fixed-frame maximum local horizontal extent was **867.57 m**. Repeating the exact 15 s / 0 m schedule produced exactly **0 m** final position difference and **0 m/s** velocity difference. Maximum immediate rebase round-trip error was at most ~**0.0437 mm**, orders of magnitude below accumulated final trajectory drift.

## What this proves

**FACT:** same-schedule execution is repeatable in this hosted runtime, while different translation-only physics-frame schedules produce materially different reconstructed world positions.

**FACT:** 1,500 m anchor offsets were strongly adverse, accumulating roughly **0.46–0.85 m** final position drift.

**FACT:** neither local extent nor rebase frequency alone predicts drift monotonically in the lower-offset cases. At 0 m anchor offset, one rebase drifted ~24 mm, eleven rebases ~52 mm and three rebases ~58 mm.

**FACT:** immediate coordinate round-trip error at the rebase is far smaller than final trajectory divergence; this is not just one bad world↔local conversion.

**INFERENCE, not policy:** physics-frame maintenance is part of simulation semantics, unlike disposable render presentation state. Future mitigation may involve engine-specific origin shifting, bounded local coordinates, authoritative high-precision reconstruction, explicit rebase scheduling or physics-island partitioning. This matrix does not choose among them.

## Contract implication

- render-local Float32 remains disposable presentation state;
- physics-local transforms remain derived/non-authoritative, but their frame schedule can affect integrated simulation outcome;
- authoritative world state plus physics frame identity/epoch and replay inputs must explain frame maintenance;
- physics/network state must not inherit renderer-origin identity or renderer transform-tree authority.

## Still open

Physics engine, precision, island extent, rebase threshold/frequency, browser/device behavior, whole-Norway CRS/index policy and render-origin threshold remain **OPEN**. This is hosted Node/WASM candidate evidence, not browser/Android, multi-body/contact-rich, rotational, sleeping/waking, terrain-collision or multiplayer acceptance evidence.

## Next

Add a contact-rich rotational scenario with sleeping/waking and snapshot/replay across a physics-frame epoch change. Reproduce informative cases in browser/device WASM before proposing production physics policy.
