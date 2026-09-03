# Nannestad — Unreal Engine 5.8

This is the new native game runtime for Norge World Engine. It is a Windows-PC,
third-person vertical slice over a real 1 × 1 km area of Nannestad. The old web
viewer is not the game architecture; this project consumes the same verified
engine-neutral world truth through an Unreal adapter.

## What exists now

- a real UE 5.8 C++ game project;
- a pinned, offline-at-runtime Nannestad snapshot;
- full NWE provenance reconstruction before conversion;
- exact EPSG:25832 + NN2000 → UE mapping (`X=east`, `Y=south`, `Z=up`);
- a deterministic 1009 × 1009 `.r16` Landscape derivative;
- 21 deterministic runtime mesh packets in the current real snapshot:
  16 terrain chunks, roads, and source/fallback-separated building surfaces;
- a runtime world bootstrap with terrain/building collision;
- Lumen GI/reflections, Virtual Shadow Maps, Sky Atmosphere, volumetric fog/clouds;
- a code-owned third-person character using Epic's Quinn mannequin/animation pack;
- an Open World / World Partition level creation script;
- focused Python and Unreal automation coverage for coordinates and derived data.

## Truth boundary

“Real Nannestad” currently means:

- terrain: real Kartverket DTM1, 1 m source grid, EPSG:25832, NN2000;
- roads: real NVDB centerlines and elevations;
- buildings: real OpenStreetMap footprints.

It does **not** yet mean every visible dimension is surveyed. The current road
widths are presentation fallbacks by road class. Most building heights are
unknown in the accepted artifact, and the bootstrap uses visibly documented
class-based presentation heights plus flat roofs. Those values never flow back
into world truth. Photorealism is not claimed until source-backed building
height/roof data, production materials, vegetation, and an actual UE render
acceptance pass exist.

## One-time setup on Windows

Requirements:

1. Unreal Engine 5.8 with C++ support;
2. Visual Studio 2022 with the *Game development with C++* workload;
3. Python 3.12+ and Node.js 22+;
4. Epic's **Third Person** feature/content pack added to this project. The setup
   fails rather than showing a capsule and calling it a human.

From PowerShell at the repository root:

```powershell
apps\unreal-runtime\SetupNannestad.ps1 `
  -UnrealEngineRoot "C:\Program Files\Epic Games\UE_5.8"
```

The script downloads only the immutable compiled NWE snapshot, reconstructs all
three provenance chains, derives the local Unreal package, builds the Editor
target, and creates `/Game/Maps/Nannestad` from Epic's
[Open World / World Partition foundation](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine).
Normal gameplay makes zero Kartverket/NVDB/OSM calls.

Open `Nannestad.uproject` and press Play. Controls are WASD, mouse, Space and
standard gamepad sticks/buttons.

## Separate data commands

```bash
python apps/unreal-runtime/Tools/nwe_unreal_pipeline.py fetch
python apps/unreal-runtime/Tools/nwe_unreal_pipeline.py verify
python apps/unreal-runtime/Tools/nwe_unreal_pipeline.py build
```

Generated geodata and Unreal build products are intentionally ignored by Git.
The committed code pins snapshot commit
`42f94b63a9172b345d4500473a0aa1aff785fa43`; changing data is a reviewed
promotion, not an implicit live refresh.

## Landscape handoff

The runtime mesh is the immediately playable bootstrap. It is not the desired
long-term terrain representation. The generated `landscape/nannestad_1009.r16`
and `world-package.json > landscape_import` record the exact UE import location,
XY scale, Z scale, north-to-south row order, and quantization error for the
native Landscape/World Partition bake. This keeps collision, foliage, RVT,
water and landscape authoring on Unreal's supported path instead of growing a
custom terrain engine.

Epic's current [Landscape import documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/importing-and-exporting-landscape-heightmaps-in-unreal-engine)
supports 16-bit `.r16` heightmaps and tiled World Partition imports. Nanite
Landscape is deliberately not forced on: Epic's
[Nanite Landscape documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-nanite-with-landscapes-in-unreal-engine)
notes that it does not improve source resolution and requires both Nanite and
regular Landscape data at runtime. It should be enabled only after a measured
frame or VSM requirement justifies the extra resident data.

## Next production gates

1. bake the generated heightmap into native Landscape/World Partition and
   verify terrain/player collision in UE 5.8;
2. replace presentation road widths with admitted NVDB width/lane semantics;
3. ingest source-backed building height/roof geometry (FKB/DOM when licensing
   and access are proven) before claiming geographic building fidelity;
4. add source-backed vegetation and production PBR material assets;
5. replace Quinn with an authored MetaHuman cast only after identity, wardrobe,
   LOD and redistribution decisions are explicit;
6. define the actual game loop. Until then this remains an honest exploration
   vertical slice, not a fabricated survival/action design.
