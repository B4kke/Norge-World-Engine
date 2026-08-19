# 2026-08-19 — High-LOD uint16 partition candidate

Role: LUMEN — Renderer & Web Platform  
Status: representation/cost experiment only; no runtime format or LOD policy selected

## Trigger

The exact Nannestad LOD error/cost probe showed that the existing 257×257 high profile contains 66,049 vertices. That exceeds the 65,535 vertex ceiling for uint16 indices, so the current single terrain mesh uses uint32 indices and its renderer terrain payload jumps to 3,158,040 B.

This note asks a narrower question: can the **same 257 geometric sampling** be represented with smaller uint16 render patches without changing runtime world-tile identity or terrain truth?

## Candidate

Partition one 1000 m runtime tile into four 500 m × 500 m renderer patches, each 129×129 vertices.

Because:

- the 257 grid has 256 cells/axis;
- each 129 grid has 128 cells/axis;
- 500 m / 128 = 3.90625 m;
- 1000 m / 256 = 3.90625 m;

all patch vertices lie on the exact same XY sample lattice as the single 257×257 mesh. With the same source sampler, origin contract and triangle diagonal, the four-patch surface can be geometrically identical to the single high mesh. Internal patch boundaries duplicate vertices but do not require a terrain-data change.

This is renderer subdivision inside one runtime tile. It does **not** redefine canonical tile identity or source tiling.

## Byte/draw projection

Using the current buffer representation (Float32 position + normal + UV in worker mesh; renderer uploads position + normal + index):

| Representation | Vertices total | Triangles | Index | Worker mesh | Renderer terrain GPU | Terrain draws |
|---|---:|---:|---|---:|---:|---:|
| one 257×257 | 66,049 | 131,072 | uint32 | 3,686,432 B | 3,158,040 B | 1 |
| four 129×129 patches | 66,564 | 131,072 | uint16 | 2,916,480 B | 2,383,968 B | 4 |

Difference:

- duplicated patch-boundary vertices: +515 (+0.78%);
- worker mesh bytes: **−769,952 B (−20.89%)**;
- renderer terrain GPU bytes: **−774,072 B (−24.51%)**;
- triangle count unchanged;
- terrain submissions: +3 per high-detail runtime tile.

A 16×65 patch layout preserves the same 3.90625 m sample spacing too, but is slightly worse in both bytes and draw count because of additional duplicated internal boundaries: 2,408,832 B renderer terrain GPU and 16 draws. Four 129 patches is therefore the more useful bounded candidate among these two square nested layouts.

## 3×3 capacity projection — not runtime evidence

If nine future real runtime tiles were all at this high detail:

- single-257 representation: ~27.11 MiB terrain GPU payload, 9 terrain draws;
- four-129 representation: ~20.46 MiB terrain GPU payload, 36 terrain draws.

That is ~6.64 MiB terrain-buffer reduction before vectors/textures/attachments/driver overhead, purchased with 27 extra terrain draws.

This is simple arithmetic, **not** a real 3×3 benchmark and not permission to bypass the DTM1 seam gate.

## Important boundary

The byte saving exists because index width changes; it does not prove that four draws are faster. On mobile WebGL2, extra draw submissions may be more expensive than the ~0.74 MiB per-tile buffer saving. WebGPU may have different tradeoffs. A same-artifact/device A/B is required.

The candidate also does not solve mixed-LOD cracks by itself. Renderer-patch internal boundaries are same-resolution and can be exact; boundaries against a neighboring runtime tile at a coarser LOD still need stitching/skirt/geomorph or an equivalent rule.

## Next benchmark

On the exact accepted Nannestad artifact and same camera/profile/device:

1. render current single 257×257 uint32 terrain;
2. render geometrically equivalent 4×129×129 uint16 patches;
3. keep terrain triangles, road/building inputs, camera, DPR/MSAA and frame window identical;
4. compare terrain GPU bytes, resource create/destroy time, first-visible, draw CPU, frame p50/p95/p99/max and largest rAF gap;
5. run WebGL2 first; repeat WebGPU only where a real adapter is available.

Do not choose partitioning before the device A/B.
