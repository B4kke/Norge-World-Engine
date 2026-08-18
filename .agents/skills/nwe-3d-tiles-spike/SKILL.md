---
name: nwe-3d-tiles-spike
description: Constrains NWE 3D Tiles/Cesium work to same-artifact measured interchange experiments; it never selects the renderer or runtime architecture by itself.
---

# NWE 3D Tiles Spike

3D Tiles and CesiumJS are **not selected architecture**. Use them only to benchmark accepted compiled NWE inputs against the custom web viewer.

Use pinned tools in `tools/runtime-packaging/`: glTF-Transform/meshoptimizer for GLB optimization and CesiumGS validation/tools for tileset/content validation. Do not implement NWE replacements for these generic tools.

Keep Cesium work in `prototypes/cesium-baseline/` until evidence justifies a production-direction boundary. Load compiled artifacts only: no Kartverket/NVDB/OSM source calls, no hidden Cesium ion dependency and no license ambiguity.

A useful comparison uses the same real Nannestad terrain/vector content, camera path, device/browser and measurement window. Record cold/warm transferred bytes, verification/decode, first-visible, RAM/VRAM estimate, frame p50/p95/p99, draw calls, tile churn and failure behavior.

A successful spike may support a proposal in `docs/04-decisions.md`; it does not itself change an open renderer/streaming decision.
