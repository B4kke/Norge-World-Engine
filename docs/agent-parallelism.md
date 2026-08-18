# Current parallel work boundaries

This is a short-lived coordination note for the current Prototype-0 milestone. Delete or fold it into permanent architecture docs once the parallel tasks land.

## Terrain/compiler lane

Branch: `agent/dtm1-terrain-vertical`  
Scope: authoritative DTM1 source selection, raw cache, CRS/datum transform, normalized terrain, compiled terrain artifact, lineage/runtime verification.  
Do not mix renderer batching or visual polish into this lane.

## Viewer/performance lane

GitHub Issue #5  
Scope: artifact-only viewer instrumentation and batching using already-compiled inputs.  
May change viewer/prototype/benchmark files. Must not change DTM/NVDB/OSM acquisition, CRS/datum semantics, compiler artifact identity or promotion rules.

## Safe additional parallel lane after terrain merge

Building enrichment can become a third lane only after the terrain artifact contract is stable on `main`: OSM relations and later DOM-DTM height evidence. Keep height enrichment as its own provenance-bearing transform; do not turn a visual fallback height into source truth.

## Integration rule

If two lanes need the same file in `docs/05-worklog.md` or `docs/06-task-queue.md`, implementation changes should land first and project-memory edits should be reconciled during PR handoff rather than allowing documentation conflicts to drive architecture.
