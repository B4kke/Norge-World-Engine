# Preview 1 implementation handoff — 2026-08-18

Temporary branch-local handoff while the real-data publication/Vercel gates execute. Merge or fold this into the canonical worklog only after hosted evidence is known.

**Gjort**
- Replaced the default synthetic Forsøk 18 product surface with a fail-closed Preview 1 loader for real compiled Nannestad terrain, roads and buildings.
- Kept Forsøk 18 as explicit `?lab=terrain` instrumentation rather than deleting the proven harness.
- Added an interactive WebGL2 Preview-1 adapter using the existing verified terrain mesh/height grid and existing compiled vector geometry.
- Added a content-addressed Preview 1 staging tool and a heavy real-data CI workflow that recompiles all three accepted source families, verifies every artifact graph/byte stream and publishes only compiled runtime data to the replaceable orphan `preview-runtime` branch.

**Bevist locally**
- `tools/preview/test_stage_preview1_snapshot.py`: 7 passed.
- `stage_preview1_snapshot.py`: `py_compile` PASS.
- `preview1Renderer.mjs`: `node --check` PASS.
- Isolated `/tmp` TypeScript checking cannot resolve repo-relative imports and is therefore not treated as a build result; Vite/Actions remains the integration gate.

**Not yet proven**
- Hosted real-data snapshot publication.
- Vite build on the exact branch head.
- Vercel Preview 1 loading the generated `preview-runtime` manifest/artifacts.
- Android/device performance.

**Next**
- Require exact-head GitHub/Vercel gates to pass before calling Preview 1 complete.
- Once real 1×1 Preview 1 is accepted, move directly to real 3×3 streaming on the same viewer/runtime path.
