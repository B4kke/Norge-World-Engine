# Nannestad near-field conifer LOD — source, bake, renderer evidence

**Date:** 2026-11-11. **Branch:** `agent/lumen-web-nannestad-1to1` (draft PR #85).  
**Role:** LUMEN. **Task:** `P1-NEAR-FIELD-TREES`.

## Motivation / real observation

Pinned daylight visual proof showed that the existing conifer and broadleaf crowns are highly
stylized cone/dodecahedron proxies. The rendered world looks incorrect up close even though
the accepted SR16V vegetation semantics and deterministic representative positions are valid.
A reusable presentation mesh can improve *local shape*, not infer the real observed tree.

## Licensing and provenance, audited offline

- Selected source: **Innerscene Conifer Light**, [official asset page](https://www.innerscene.com/tools/library/3d-parts/conifer-light-sprays-1014156d).
- License marker: model page and GLB glTF `asset.copyright` identify CC0 1.0
  ([Creative Commons CC0](https://creativecommons.org/publicdomain/zero/1.0/)).
  The intake checks a fresh live page CC0/public-domain marker and refuses a changed source.
- Bound raw source GLB (preprocessing-only): **517,112 bytes**,
  SHA-256 `812f691eb68119681038aed7f45dd80bff0a152afe1fc8160ea5cbeeae9143da`.
- Source GLB v2: **365 meshes**, **8,792 triangles**, **two material colors**, no
  referenced images/textures. Preprocessing fetches this source from the
  fixed provider URL; browser does **not** request the model provider.

## Reproducible render derivative

`tools/visual-data/build_nannestad_tree_lod.py` uses pinned NumPy and trimesh
to flatten source-node transforms, turn original PBR main colors into explicit
vertex `COLOR_0`, join face/index buffers, center horizontally, ground feet at
Y=0 and validate 8 m nominal height. Mesh identity/bounds, material color
diversity, triangles and exact SHA are checked; both source and output have
strict byte caps.

- **Accepted color-preserving derivative:** 232,160 bytes,
  SHA-256 `77705f017031ac8d7f7a31d78d5b24268eecd56da93bd051cfadee16230be3ba`.
- **One mesh**, 7,856 vertices, 8,792 triangles, GLB `COLOR_0` present.
- The first 200,532-byte/201 kB prototype **lacked `COLOR_0`**. Real browser
  refused it (`NWE_TREE_BAKED_VERTEX_COLORS_MISSING`); it was **rejected and
  superseded**, not silently accepted or sold as faithful material rendering.
- Confirmed identical derivative SHA in independent `preview1-visual-proof`
  and `preview1-realdata-publish` source-bake runs for exact code head
  `d0ad34b2256f299bc88f93360abafaa0c87b058c`.
- The derivative and its hashed JSON provenance report are stored only in
  replaceable runtime staging or short-lived Actions artifact; raw authoring
  data is not committed.

## Runtime boundaries and cost

- Normal browser verifies derivative and report SHA/bytes **from the same
  manifest origin**, validates source SHA, license marker and GLB header.
  `GLTFLoader` parses only verified bytes; no CDN/provider call at runtime.
- A **single InstancedMesh** is eligible for at most **36** near-camera
  spruce/pine/conifer-mixed representatives within **125 m** (balanced: 18,
  low: 0). At the 36-instance cap the near layer is at most
  **316,512 triangles** (36×8,792) plus the unchanged far proxies.
- Selected conifer proxies (stem+old crowns) use zero-scale matrices; they
  are restored on camera movement. SR16 placement, ID, and height are not
  rewritten.
- Existing low-LOD/far-field proxy path remains available and tested.
  Group `deciduous` remains old proxy and is **not** claimed improved.

## Evidence, status and visual review

- Source-gate and offline adversarial bake tests PASS; output byte size and
  derivative colors verified from exact GitHub Actions artifact.
- `world-viewer-vite` run
  [42939776254](https://github.com/B4kke/Norge-World-Engine/actions/runs/42939776254):
  **PASS**, including camera-based proxy swap tests.
- `preview1-visual-proof` run
  [42939776160](https://github.com/B4kke/Norge-World-Engine/actions/runs/42939776160):
  **PASS**, actual WebGL2 screenshot with SHA-verified color-preserving model,
  source-pinned daylight.
- Daylight screenshot inspected: source world renders with road/building/trees;
  the fixed central camera mainly sees distant **deciduous proxies**, so this
  screenshot **does not yet demonstrate a near-conifer appearance uplift**.
  Need a controlled camera closer to a source-derived conifer for visual A/B.
- `preview1-realdata-publish` run
  [42939776278](https://github.com/B4kke/Norge-World-Engine/actions/runs/42939776278)
  compiled/verified the derivative but its existing browser request-set
  whitelist omitted the new `tree_asset.report_path`; this gate was
  corrected in subsequent commit `3774a2080cf34dfdec4f301fdf611df8bece94cf`
  without loosening same-origin or manifest request auditing.
  Re-check newest head before claiming publish PASS.

**Not proven:** photo-real canopy detail, asset species identity for all
individual SR16 representatives, camera-facing geometry at the closest
available conifer, physical-device FPS under continuous fast movement,
and LoD2 roofs. Tree choice is a bounded presentation/LOD experiment, not
a source-data or core world-model decision.
