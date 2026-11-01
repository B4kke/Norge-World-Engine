# Poly Haven PBR material set

The adjacent `manifest.json` is the authoritative local catalog for four
seamless 1K JPG PBR surfaces used by the Nannestad reference renderer and by
the Unreal Editor material-import script.

- Source: [Poly Haven](https://polyhaven.com/)
- License: [CC0 1.0](https://polyhaven.com/license)
- Assets: `forest_ground_04`, `asphalt_02`, `weathered_plank_siding`,
  `grey_roof_01`
- Maps retained: diffuse, OpenGL normal, DirectX normal and roughness
- Runtime policy: local, same-origin files only; no Poly Haven API or CDN call
  is made by either game runtime

Every retained file is pinned by byte size, MD5 from the official Poly Haven
files API and a locally verified SHA-256 digest. WebGPU/WebGL uses the OpenGL
normal maps. Unreal imports the DirectX normal maps. These assets change only
the presentation layer; they do not change terrain, road or building truth.
