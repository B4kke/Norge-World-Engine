# 2026-08-18 — VEKTOR runtime coordinate precision evidence

## Scope

Numerical experiment only. No terrain source/compiler, tile identity, streaming scheduler, renderer, viewer batching or artifact identity is changed.

Prototype-0 EPSG:25832 coordinates are used only for their numeric magnitude (`E≈611000`, `N≈6677000`). Whole-Norway CRS/index strategy remains open. Additional south/mid/north regional probes use their appropriate ETRS89 / UTM zones only to test representative numeric magnitudes; they do not select a whole-Norway runtime CRS.

## Execution

Local authoring run: Node `v22.16.0`, V8 `12.4.254.21-node.26`, Linux x64.

Hosted GitHub Actions run `32075398577`, job `95527373206`: Node `v22.23.2`, Linux x64, **PASS** for both deterministic regressions and benchmark. Ordinary repo baseline on the same head also passed.

```bash
node prototypes/runtime-coordinate-precision/test_precision.mjs
node prototypes/runtime-coordinate-precision/benchmark.mjs
```

## Evidence

### Absolute Float32 is insufficient at Prototype-0 world-coordinate magnitude

- Float32 ULP at easting `611000 m`: **0.0625 m**.
- Float32 ULP at northing `6677000 m`: **0.5 m**.
- `6677000.1` quantizes back to `6677000`; the entire **10 cm** offset is lost.
- `6677000.25` also quantizes to `6677000`; error is **25 cm**.

This is a numeric precision result only; it does not depend on a renderer implementation.

### The horizontal northing problem persists across regional Norway magnitudes

Four fixed regional numeric probes were derived with pyproj/PROJ from WGS84 test coordinates into the appropriate ETRS89 / UTM zone and then used as dependency-free benchmark inputs:

| Probe | EPSG | Easting | Northing | Easting Float32 ULP | Northing Float32 ULP |
| --- | ---: | ---: | ---: | ---: | ---: |
| south | 25832 | 440892.105 m | 6429147.611 m | 0.03125 m | **0.5 m** |
| mid | 25832 | 569937.382 m | 7030921.371 m | 0.0625 m | **0.5 m** |
| north | 25833 | 653210.089 m | 7731796.830 m | 0.0625 m | **0.5 m** |
| far north | 25835 | 576330.657 m | 7767125.171 m | 0.0625 m | **0.5 m** |

Thus the direct-Float32 northing issue is not specific to Nannestad: all four regional probes have **0.5 m representable spacing** at their absolute northing magnitude. A local ~1 km rebase probe remains below 0.05 mm reconstruction error for every regional case.

These probes test numeric magnitude, not a proposal to store all Norway in one UTM zone.

### Local-origin Float32 retains sub-mm precision over large local radii

Observed probe maxima after `Float64 world - Float64 origin -> Float32 local -> Float64 reconstruction`:

| Local radius | Float32 ULP | Observed max error |
| ---: | ---: | ---: |
| 1 m | 0.000119 mm | 0.000059 mm |
| 10 m | 0.000954 mm | 0.000404 mm |
| 100 m | 0.007629 mm | 0.003784 mm |
| 1 km | 0.061035 mm | 0.023438 mm |
| 10 km | 0.976563 mm | 0.433950 mm |
| 100 km | 7.8125 mm | 3.4723 mm |
| 250 km | 15.625 mm | 7.0000 mm |
| 500 km | 31.25 mm | 11.0000 mm |
| 1000 km | 62.5 mm | 27.7777 mm |

IEEE-754 rounding gives a worst-case bound of approximately half an ULP. Precision alone therefore permits a much larger local radius than a 1 km tile. Examples:

- keeping local coordinate magnitude below **32.768 km** keeps worst-case Float32 rounding below about **1 mm**;
- keeping it below **262.144 km** keeps worst-case Float32 rounding below about **1 cm**.

These are precision ceilings, **not recommended origin-shift thresholds**. Culling, physics, renderer transforms, entity ownership, tile lifecycle and device evidence can require a much tighter policy.

### Z is not the dominant Prototype-0 precision problem

For a `200.001 m` height probe, direct Float32 storage produced about **0.0071 mm** error; Float32 ULP at 200 m is about **0.0153 mm**. The large horizontal northing magnitude is the immediate precision hazard in the current prototype.

### Origin shifts should recompute from authoritative world coordinates

A deterministic adversarial sequence performed 10,000 random origin shifts.

- recomputing Float32 local coordinates from authoritative Float64 world positions: maximum reconstruction error during the wandering sequence **3.906 mm**; after returning to the original origin, **0.024 mm**;
- repeatedly mutating already-quantized Float32 local coordinates: final error after returning to the same origin **83.032 mm**; separate exploratory run observed peak drift about **140.66 mm**.

This disproves a tempting implementation shortcut: repeated in-place Float32 rebasing can accumulate visible drift even when the origin eventually returns to the same value.

### Host CPU rebasing is cheap enough to keep as a candidate

Hosted Node/V8 rebasing of xyz `Float64Array -> Float32Array` reported:

- 10k entities: median **0.0229 ms**, p95 **0.0234 ms**;
- 100k entities: median **0.2285 ms**, p95 **0.2448 ms**.

These timings are **host-only directional evidence**. They are not Android/browser/main-thread acceptance numbers and no CPU budget is accepted from them.

## What is proved

1. Direct absolute Float32 storage of current Prototype-0 horizontal world coordinates cannot preserve sub-meter geometry reliably.
2. The same 0.5 m northing spacing occurs at representative south/mid/north ETRS89 / UTM magnitudes, so this is not a Nannestad-only precision artifact.
3. Subtracting a nearby high-precision origin before Float32 storage removes the immediate precision problem by several orders of magnitude.
4. For origin shifts, authoritative world coordinates should remain high precision and local Float32 positions should be regenerated from that authority rather than repeatedly mutated.
5. Precision by itself does not force a tile-sized origin-shift threshold; the eventual threshold must be chosen with runtime/device/physics evidence.

## What is not decided

- final whole-Norway CRS or index;
- final floating-origin trigger/radius;
- whether origin follows camera, player, tile cluster or another anchor;
- renderer/API choice;
- terrain/mesh/streaming format.

No entry is added to `docs/04-decisions.md` from this experiment alone.
