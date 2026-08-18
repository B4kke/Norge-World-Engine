# Preview 1 PR scope

This file is a branch-local review aid and can be removed or folded during merge.

- Default World Viewer becomes real compiled Preview 1 and fails closed without valid runtime artifacts.
- Forsøk 18 remains available only as explicit lab mode.
- Snapshot CI recompiles real DTM1/NVDB/OSM inputs, then publishes only verified compiled artifacts.
- No raw geodata, credentials, final renderer choice, final CDN/object store choice, road-width semantics or building-height semantics are introduced.
- Local transport/security regressions: 7 passed.
