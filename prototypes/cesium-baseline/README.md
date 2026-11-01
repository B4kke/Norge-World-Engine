# CesiumJS / 3D Tiles baseline

Purpose: provide a measured reference implementation for `P0-ARCH-REUSE-01` without selecting CesiumJS as the NWE renderer.

The harness loads **only a compiled 3D Tiles tileset URL** and records tile load/unload/progress plus time to Cesium's `initialTilesLoaded` event. It deliberately starts without Cesium ion imagery/token dependencies.

The root `package.json` overrides keep `cesium@1.143.0` paired with
`@cesium/engine@26.1.0` and `@cesium/widgets@16.1.0`, the base versions declared
in its published npm metadata. Resolving its caret ranges to engine 26.3.0 /
widgets 16.2.0 breaks three shader re-exports during the Vite build. Update this
family together and run `npm run build:cesium-baseline`; do not suppress missing
exports or skip the CI build. This pin is scoped to the historical prototype,
not a change to the active Unreal runtime.

```bash
npm install
npm run dev:cesium-baseline
# open the printed URL with:
# ?tileset=/runtime/nannestad/tileset.json
```

Compare this baseline against the custom viewer using the same compiled Nannestad artifact and device. The decision remains open until cold/warm load, transferred bytes, memory, first-visible latency, frame time, draw calls and tile churn are measured.
