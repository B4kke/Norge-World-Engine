# Third-party notices

Norge World Engine keeps externally sourced Agent Skills pinned and reviewable instead of installing an unbounded global skill collection.

## GDAL skill

- Upstream: `isaaccorley/geospatial-skills`
- Pinned commit: `a203446cb997cd1dbf054918b1021a6040b69824`
- Vendored files:
  - `.agents/skills/gdal/SKILL.md`
  - `.agents/skills/gdal/references/gdal-recipes.md`
- License: Apache License 2.0
- Local license copy: `third_party/licenses/isaaccorley-geospatial-skills-Apache-2.0.txt`

The vendored GDAL files are copied from the pinned upstream revision.

## Source Driven Development skill

- Upstream: `addyosmani/agent-skills`
- Pinned commit: `df1edb2e05487d0aa6d93c747141e0aed1187f25`
- Vendored file: `.agents/skills/source-driven-development/SKILL.md`
- License: MIT
- Local license copy: `third_party/licenses/addyosmani-agent-skills-MIT.txt`

The local copy is intentionally compacted for Norge World Engine while retaining the upstream workflow's source-verification purpose. It is therefore a modified derivative; this notice preserves upstream attribution and the MIT license.
