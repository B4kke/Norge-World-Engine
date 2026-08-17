# CesiumJS / 3D Tiles baseline

Purpose: provide a measured reference implementation for `P0-ARCH-REUSE-01` without selecting CesiumJS as the NWE renderer.

The harness loads **only a compiled 3D Tiles tileset URL** and records tile load/unload/progress plus time to Cesium's `initialTilesLoaded` event. It deliberately starts without Cesium ion imagery/token dependencies.

```bash
npm install
npm run dev:cesium-baseline
# open the printed URL with:
# ?tileset=/runtime/nannestad/tileset.json
```

Compare this baseline against the custom viewer using the same compiled Nannestad artifact and device. The decision remains open until cold/warm load, transferred bytes, memory, first-visible latency, frame time, draw calls and tile churn are measured.
