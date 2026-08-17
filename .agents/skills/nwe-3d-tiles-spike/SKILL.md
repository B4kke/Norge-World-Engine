---
name: nwe-3d-tiles-spike
description: Constrains NWE 3D Tiles/Cesium work to measured runtime-interchange experiments. Use for P0-ARCH-REUSE-01, tileset validation, GLB optimization and the CesiumJS baseline.
---

# NWE 3D Tiles Spike

3D Tiles and CesiumJS are **not selected architecture**. Use them only to benchmark an existing compiled NWE artifact against a custom viewer.

Use pinned tools in `tools/runtime-packaging/`: glTF-Transform/meshoptimizer for GLB optimization and CesiumGS `3d-tiles-validator` for tileset/content validation. Do not write an NWE replacement for these generic tools.

Use `prototypes/cesium-baseline/` for CesiumJS tests. Load compiled tiles only; no Kartverket/NVDB/OSM source API calls and no hidden Cesium ion dependency. Compare the same Nannestad artifact/device on cold/warm load, transferred bytes, first visible latency, memory, frame time, draw calls and tile churn.

A successful spike may justify a decision proposal; it does not itself change `docs/04-decisions.md` from open to selected.
