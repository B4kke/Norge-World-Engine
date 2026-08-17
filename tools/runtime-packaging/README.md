# Runtime packaging tools

This workspace deliberately reuses mature interchange tooling instead of implementing generic mesh compression or 3D Tiles validation in NWE.

Pinned tools:

- `@gltf-transform/cli` for reproducible glTF/GLB optimization.
- `meshoptimizer` as the mesh compression/optimization implementation used by the asset pipeline.
- `3d-tiles-validator` for official 3D Tiles 1.0/1.1 + glTF validation.
- `3d-tiles-tools` for conversion/processing experiments.

Examples after `npm install` at repo root:

```bash
npm --workspace @nwe/runtime-packaging exec -- gltf-transform optimize input.glb output.glb
npm --workspace @nwe/runtime-packaging exec -- gltf-transform meshopt input.glb output.meshopt.glb --level medium
npm --workspace @nwe/runtime-packaging exec -- 3d-tiles-validator --tilesetFile path/to/tileset.json
```

3D Tiles is an **experimental runtime interchange candidate**, not an accepted NWE engine/runtime format. Keep collision, nav and simulation sidecars separate from render LOD data.
