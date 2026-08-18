---
name: nwe-world-model
description: Defines NWE high-precision world-state, render-local coordinate, origin-shift and temporal-origin experiments without prematurely selecting a whole-Norway coordinate policy.
---

# NWE World Model

Authoritative world state and disposable render-local coordinates are separate contracts. Current evidence shows EPSG:25832-scale absolute Float32 is too coarse for a high-quality renderer, while high-precision world state can survive deterministic render-origin shifts. This does not select a final whole-Norway coordinate model or shift threshold.

Keep static geodata identity separate from dynamic entity/simulation state. A renderer may derive local Float32 positions from higher-precision world coordinates, but it never becomes the authority for world state.

Every origin shift needs an explicit origin identity/epoch. Temporal systems must not interpret a local-frame jump as physical velocity or acceleration. Test origin-shift behavior for camera, entity motion, interpolation, physics and later networking before choosing thresholds.

Candidate policies belong in isolated experiments or `engine/world`/world-contract code only after clear interfaces and regressions exist. Measure numerical error and CPU cost at realistic Norway-scale coordinates and entity counts.

Changing whole-Norway indexing, coordinate authority or temporal-origin semantics requires evidence and an explicit decision record. LUMEN consumes the world-to-render contract; it does not invent one inside shaders/view code.
