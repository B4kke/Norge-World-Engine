# Preview 1 acceptance

Preview 1 is accepted only when the normal Vercel World Viewer loads the real compiled Nannestad 1 × 1 km scene with verified terrain, roads and buildings and zero raw-source runtime acquisition.

Required visible/runtime properties:

- real DTM1 terrain;
- real NVDB road paths;
- real OSM building footprints;
- full provenance + artifact-byte verification for all three layers;
- browser DedicatedWorker terrain mesh generation;
- interactive orbit/zoom;
- explicit debug semantics for non-authoritative road width and unresolved building height;
- no silent synthetic fallback.

The subsequent Preview 2 gate is real 3 × 3 dynamic streaming through the same viewer/runtime architecture.
