# Fresh-eye audit — hyperreal Nannestad direction

Date: 2026-11-01  
Status: **proposal / experiment plan, not an accepted architecture decision**  
Reviewed surface: active Web realism branch (`agent/lumen-web-nannestad-1to1`) plus renderer-neutral engine/compiler foundation.

## Product interpretation

The desired product is a ground-level, metre-scale, highly realistic Nannestad in Three.js/WebGPU, while the same compiled Norwegian world can later be consumed by Unreal Engine and can scale to nationwide streaming.

`1:1` must be split into separate claims:

1. **metric/geographic 1:1** — correct scale, terrain, object positions and dimensions where source data supports them;
2. **visual realism** — materials, assets, lighting and believable microdetail;
3. **observational fidelity** — the exact real roof, façade, tree, sign face, etc. at a coordinate.

The first is realistic nationwide. The second is realistic with a good render pipeline and asset system. The third is only partially attainable from open nationwide sources and must remain source/coverage dependent.

## Executive finding

The project architecture is substantially better than the current screenshot quality suggests. The engine-neutral compiler boundary, provenance chain, Float64 world state/render-local Float32 contract, explicit truth guards, NVDB decomposition and streaming scheduler are worth preserving.

The main risk is now **polishing low-fidelity reconstruction proxies instead of increasing source-derived geometry fidelity**. More SSR, bloom, DOF or procedural façade detail cannot turn an approximately reconstructed place into an observationally faithful one.

Recommended direction: keep the world/runtime foundation, but pivot the visible-quality effort to a **LiDAR-first visual reconstruction pipeline**. Treat current procedural vegetation/facades and the 129×129 terrain render mesh as prototype/fallback LODs rather than the final near-field representation.

## What is particularly strong and should survive

### 1. Renderer-neutral world truth

Keep compiler/provenance/world state independent of Three.js and Unreal. This is the most strategically valuable decision in the repository.

### 2. Provenance and fail-closed artifacts

The SHA/JCS lineage model is unusually strong for a world-engine prototype. Preserve it for every new reconstruction derivative: LAZ crop, CHM, roof mesh, tree candidates, render tiles and texture assets.

### 3. Coordinate authority

Keep authoritative Float64 state and render-local Float32 after origin subtraction. EPSG:25832 + NN2000 is appropriate as a Nannestad reconstruction frame, but it must not become the nationwide addressing policy.

### 4. NVDB compiler direction

Keep NVDB as the source of road topology/semantics/street furniture where present. The existing source-backed width/surface/detail work is useful and should become the semantic input to better road-surface meshing, not be discarded.

### 5. Streaming scheduler/cache lifecycle

Keep the scheduler, resident budgets, preemption and lifecycle abstractions. Replace/extend the payloads it streams rather than replacing the scheduler merely to chase a format.

### 6. SR16 semantics

Keep SR16 for forest class, height/density/uncertainty and regional calibration. Do **not** use SR16 representative points as the final claim for individual tree positions.

## What should stop receiving primary effort

### 1. Procedural near-field tree proxies

Current trees use simple instanced cylinders/cones/dodecahedra with deterministic jitter. This is excellent as a cheap fallback/LOD/debug representation, but it has reached the point of diminishing returns for hyperrealism.

Action: freeze proxy-shape refinement. Reuse the layer for fallback/far LOD while a real asset + LiDAR placement path is tested.

### 2. Synthetic façade windows/doors as the realism path

The current façade layer deterministically places generic windows and doors from footprint edges and assumed floor heights. This can make a generic game town look richer, but it can also make a real place look confidently wrong.

Action: disable or strongly down-rank this layer in the future `hyperreal` profile unless a building has supporting semantics. Prefer a geometrically correct façade with plausible material over invented aperture layout. Add exact façade detail later only from licensed imagery/manual hero assets/source data.

### 3. Post-processing as a substitute for scene fidelity

SSR/GTAO/god-rays/DOF/bloom/chromatic aberration/film grain are presentation effects. Keep conservative IBL, exposure, shadows and contact AO. Keep the heavier stack as optional `ultra/demo` presentation, but stop treating it as the main realism frontier.

### 4. 129×129 near-field terrain mesh

`buildTerrainMeshBuffers()` defaults to `outputSize=129`. Across a 1 km tile this is ~7.8125 m planar vertex spacing, despite a 1 m source height grid. Full-resolution height sampling still protects grounding, but the visible surface cannot reproduce small ditches, crowns, cuts and local terrain shape at walking distance.

Action: add distance-adaptive terrain LOD. Near-player geometry should preserve materially more of the 1 m source; farther rings can retain aggressive decimation. Do not simply render one million vertices per 1 km tile everywhere.

### 5. Raw GitHub JSON as a production transport model

Commit-pinned/raw-GitHub URLs and JSON realism layers are good proof transport. They are not the desired nationwide runtime delivery model.

Action: retain the manifest/provenance semantics, then package production render payloads as binary/streamable tile bundles.

## Key new source opportunity: LiDAR-first Nannestad

### Verified source facts

- Kartverket reports the nationwide NDH is complete, primarily from airborne LiDAR, with at least 2 pts/m² for the national programme and substantial areas at 5 pts/m².
- A Kartverket report explicitly identifies **“Gjerdrum Ullensaker Nannestad” at 5 pts/m², 2020**.
- A separate engineering report using the same Nannestad source describes the 2020 acquisition and a 0.25 m raster derivative for its local work.
- Kartverket/Geovekst currently lists **“Romerike laser 2025”** including Nannestad as an ongoing laser project as of this audit.
- Kartverket tooling/documentation supports LAS classes including ground, low/medium/high vegetation and building; exact classes present must still be inspected in the Nannestad LAZ bytes before relying on them.

Primary references:
- https://kartverket.no/geodataarbeid/nasjonal-detaljert-hoydemodell/status-hoydemodell
- https://forvaltningsinformasjon.geonorge.no/mapping-projects/geovekst/projects
- https://www.kartverket.no/globalassets/geodataarbeid/geovekst/motedokumenter/rapport-kvalitetsforskjell-pa-laserskanning-2-5-og-10-pkt-pr-m2.pdf
- https://hoydedata.no/LaserInnsyn2/

### Why this is higher value than another shader pass

A point cloud can potentially improve three current weak spots from one source family:

1. roof planes / roof shape;
2. canopy height and candidate individual-tree positions;
3. terrain/ditch/cut microtopography and surface break awareness.

This does not automatically provide façade textures, exact window positions, species identity for every tree or current-year geometry. It is a reconstruction source, not magic photogrammetry.

## Proposed visual reconstruction pipeline

```text
RAW / PROVIDER DATA
  DTM/LAZ + NVDB + OSM/open footprints + SR16 + land cover + optional licensed imagery
        |
        v
CANONICAL WORLD TRUTH
  source snapshots + CRS/datum + normalized terrain + semantic roads/buildings/forest
        |
        v
VISUAL RECONSTRUCTION (new explicit layer)
  roof reconstruction
  road-surface/intersection generation
  CHM/tree-candidate extraction
  land-cover/material masks
  source-quality/fallback classification
        |
        v
RENDER TILE COMPILER
  terrain LOD meshes
  building GLB meshes
  road GLB meshes
  vegetation instance clusters
  KTX2/Basis texture/material payloads
  metadata/provenance sidecar
        |
        +--------------------+
        |                    |
        v                    v
THREE.JS / WEBGPU        UNREAL ADAPTER
render-local Float32     same assets/world IDs
streamed active set      engine-native derived resources
```

Critical rule: reconstruction output is versioned derived data and must retain enough metadata to distinguish **observed/source-backed**, **derived**, and **procedural/fallback** semantics.

## Buildings: recommended experiment

Use the 2020 Nannestad LAZ point cloud plus the best legal 2D footprint available and test automatic LoD2 reconstruction.

`3DBAG/roofer` is a strong experiment candidate because it reconstructs LoD1.2/1.3/2.2 building models from classified aerial LiDAR + roofprint polygons and exposes reconstruction quality metadata. It expects at least ground/building classes and says its best results are around ~10 pts/m², so the 5 pts/m² Nannestad source is **not assumed sufficient** — it must be measured.

Roofer is GPLv3. Treat it as an external preprocessing tool during the experiment; do not embed its code into NWE runtime. Verify licensing implications before promoting it into a production build service.

References:
- https://github.com/3DBAG/roofer
- https://innovation.3dbag.nl/roofer/data_requirements.html

Fallback hierarchy should be explicit:

1. validated LiDAR-derived LoD2 roof geometry;
2. source-backed 2.5D geometry/height where legally available;
3. footprint + measured/derived height LoD1;
4. explicit fallback only as last resort.

FKB-Bygning would be attractive technically (0.2–0.5 m stated positional accuracy and 2.5D geometry), but current product information says download is restricted to Norge digitalt parties and private actors must buy access. Therefore it must remain an optional licensed enrichment, not the free public baseline.

## Vegetation: recommended experiment

Replace “SR16 representative XY = tree position” with:

- DTM + surface/LiDAR -> canopy height model (CHM);
- local-maxima / crown-segmentation -> deterministic tree candidates;
- LiDAR canopy height -> per-instance height;
- SR16 -> species-group probabilities, density plausibility and uncertainty calibration;
- land-cover/roads/buildings/water -> exclusions;
- high-quality Norwegian tree asset library -> visual instances.

Caveat: airborne LiDAR will miss suppressed/understory trees and cannot make every tree an observed exact individual. The output should be named `tree-candidate` or similar, with confidence/source epoch, not `observed-tree` unless a stronger method supports that claim.

## Roads: keep semantics, replace the simplistic surface generator over time

The current miter-strip road mesh is a sound first renderer. For hyperrealism, move toward a compiled road surface model:

- NVDB centerline/topology + source-backed widths;
- edge/kerb/sidewalk/ditch geometry when present;
- junction/intersection polygon generation rather than overlapping strips;
- lane/marking semantics where source-backed;
- correct crown/crossfall only when source or a clearly procedural road-profile policy is available;
- decal/mesh markings and instanced furniture;
- terrain cuts/blends generated offline to prevent floating/z-fighting strips.

Do not replace NVDB with OSM for the authoritative road semantics. OSM can remain a gap/reference source where useful.

## Terrain: use the 1 m truth more intelligently

Do not choose between “129² forever” and “1000² everywhere”. Compile an LOD pyramid or clipmap-friendly mesh family from the accepted 1 m terrain:

- near field: high-detail source-derived mesh;
- mid field: decimated/quantized mesh;
- far field: coarse terrain/HLOD;
- collision/grounding: independent source-derived height representation, scoped around active entities.

Preserve border samples / seam contracts so LOD and neighboring tiles cannot crack.

## Runtime packaging and whole-Norway portability

### Recommendation

Do **not** make Three.js scene objects or Unreal assets the canonical data format.

Introduce two runtime artifact families:

1. **semantic world tile** — renderer-neutral IDs, coordinates, provenance, physical/source semantics;
2. **render tile** — glTF/GLB meshes, compressed textures, instance buffers and LOD metadata derived from the semantic tile.

Use glTF/GLB as the primary render payload where practical. It is well supported in web pipelines and is also a natural input to Unreal/Cesium-style adapters.

### 3D Tiles

3D Tiles 1.1 is specifically designed for massive heterogeneous geospatial streaming and supports hierarchical LOD, implicit tiling and direct glTF content. It is therefore a **strong packaging/interoperability candidate**, especially because Cesium for Unreal consumes streamed 3D Tiles/glTF and current Cesium for Unreal supports UE 5.8.

However, do not prematurely replace NWE's scheduler/world model with Cesium. Proposed experiment:

- keep NWE semantic world truth and scheduler contracts;
- export one reconstructed Nannestad tile hierarchy to 3D Tiles 1.1;
- compare a Three/WebGPU path against the native NWE tile-bundle path;
- verify current Three/WebGPU renderer-library compatibility and memory behavior before choosing the production stream container;
- retain a 3D Tiles exporter even if NWE keeps its own web scheduler, because it provides a valuable Unreal/interop route.

Primary references:
- https://www.ogc.org/standards/3dtiles/
- https://threejs.org/manual/pages/webgpurenderer
- https://cesium.com/learn/cesium-unreal/ref-doc/

## Whole-Norway coordinate issue to solve before scale-out

The existing world contract correctly says EPSG:25832 is not a Norway-wide policy. Keep that guard.

Candidate direction for later prototype:

- globally stable tile/anchor identity in EUREF89/geodetic or ECEF;
- source/reconstruction performed in the best local projected CRS;
- each render tile stores a high-precision world anchor plus render-local coordinates;
- Three/UE receives local Float32 coordinates after Float64 anchor subtraction.

This aligns naturally with large-world/3D Tiles concepts without forcing the simulation to become a Cesium globe.

No nationwide coordinate policy is selected by this audit.

## Newly discovered maintenance risk: 2026 Norwegian CRS update

Kartverket changed the official HREF model on 2026-10-14 to HREF2025A/NN2000:2025 and states that correct ITRF2014/2020 -> EUREF89 transformations using the new national EPSG codes require PROJ 9.9.0 or newer.

The compiler currently pins `pyproj==3.7.2`; its documentation reports PROJ 9.6.2 for the documented build. Existing EUREF89 projected-to-projected Nannestad transforms are not thereby proven wrong, and Nannestad is outside the areas with the larger HREF change, but future GNSS/global/ECEF interoperability should not silently assume the current dependency stack is 2026-reference-frame complete.

Action: add a separate CRS maintenance gate before introducing GNSS/ECEF or nationwide transforms. Do not casually bump the geospatial stack without replaying canonical transform/hash tests.

References:
- https://www.kartverket.no/til-lands/posisjon/href-hoydereferansemodeller-og-transformasjonsmodeller
- https://www.kartverket.no/om-kartverket/nyheter/alle/2026/oktober/ny-href-modell-og-nye-epsg-koder-gir-mer-presise-hoyder-og-bedre-datakvalitet

## Blender MCP: where it helps and where it should not sit

Use Blender as an **offline asset/reconstruction tool**, never as world truth or a per-tile runtime dependency.

Good uses:
- curate/retopologize Norwegian tree assets;
- generate LODs and impostors;
- UV unwrap and bake PBR textures;
- repair a small number of important/failed roof reconstructions;
- create reusable road furniture/material assets;
- author a limited set of hero buildings where imagery rights permit.

Poor uses:
- manually model Nannestad as the primary pipeline;
- bake one giant scene;
- make Blender files the authoritative coordinate database;
- require Blender during browser runtime.

## Repository/process risk

The active Web realism PR is a large draft stacked on a large Unreal foundation draft. That makes the actual working product substantially ahead of `main`, while review/integration risk grows.

Recommended cleanup after this audit is agreed:

1. merge/extract renderer-neutral compiler/world/provenance improvements into `main` in bounded PRs;
2. keep UE adapter work separate;
3. create a focused Web hyperreal branch from the updated neutral foundation;
4. close/archive superseded visual experiments rather than letting multiple long-lived renderer branches represent competing truth.

Do not perform a destructive branch rewrite merely for cleanliness; preserve working evidence and migrate in small changes.

## Highest-value next experiment

### `P0-HYPERREAL-LIDAR-01 — Nannestad LiDAR gold-tile probe`

**Goal:** determine whether open/current Nannestad LiDAR materially improves near-field geometry enough to justify the pivot.

**Scope:** the existing accepted 1×1 km tile only.

**Steps:**

1. Acquire the exact LAZ project/tile(s) intersecting the current NWE 1 km bounds. Record project ID, acquisition date, point density, CRS, vertical reference, license/access method and SHA-256.
2. Inspect actual LAS class histogram. Do not assume building/vegetation classes from generic standards.
3. Crop a reproducible local source snapshot.
4. Build a CHM and extract deterministic tree candidates with confidence/height.
5. Run Roofer (or a second independent roof-plane prototype) on a representative subset and then all eligible buildings. Record reconstruction status/quality per building.
6. Produce **derived renderer-neutral** roof meshes/tree-candidate artifacts with provenance.
7. Compile one Web render tile using real GLB tree assets and the higher-detail terrain path.
8. Render the same fixed camera positions before/after and record payload bytes, CPU preparation, GPU memory estimate, draw calls and frame-time observations.
9. Do not promote the pipeline if visual fidelity does not materially improve or if source quality fails.

**Acceptance:**
- actual Nannestad LAZ source verified and reproducibly cropped;
- class/density facts measured from bytes;
- >=20 representative buildings evaluated with explicit success/fallback counts;
- tree candidates demonstrably follow canopy structure rather than SR16 random/representative XY;
- fixed-view A/B shows a material geometric improvement;
- all new derivatives retain source/derived/fallback semantics;
- no raw provider request is added to runtime.

## Decision after the experiment

Only after `P0-HYPERREAL-LIDAR-01` should the project consider an accepted decision such as “LiDAR-first reconstruction is the production visual-geometry path”. If it fails, keep the current semantic foundation and test a different visual source strategy without discarding the engine.
