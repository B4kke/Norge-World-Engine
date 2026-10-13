import assert from 'node:assert/strict';
import { enrichBuildingsForWeb } from './src/buildingRealismEnrichment.mjs';
import { buildBuildingSurfaceGeometry } from './src/buildingSurfaceGeometry.mjs';

const buildings = {
  features: [
    { source_id: 'osm:1', building: 'house', polygon: [[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]], height_m: 6.5 },
    { source_id: 'osm:2', building: 'house', polygon: [[20, 0], [30, 0], [30, 8], [20, 8], [20, 0]], height_m: null },
    { source_id: 'osm:3', building: 'garage', polygon: [[40, 0], [46, 0], [46, 5], [40, 5], [40, 0]], height_m: null },
    { source_id: 'osm:4', building: 'shed', polygon: [[60, 0], [64, 0], [64, 4], [60, 4], [60, 0]], height_m: null },
  ],
};
const surfaces = {
  features: [
    { source_id: 'osm:1', building: 'house', footprint_area_m2: 48, sample_count: 40, height_delta_m: { p90: 7.1 }, roof_relief_p95_p25_m: 2.0 },
    { source_id: 'osm:2', building: 'house', footprint_area_m2: 80, sample_count: 35, height_delta_m: { p90: 7.4 }, roof_relief_p95_p25_m: 2.2 },
    { source_id: 'osm:3', building: 'garage', footprint_area_m2: 30, sample_count: 30, height_delta_m: { p90: 12.0 }, roof_relief_p95_p25_m: 1.0 },
  ],
};
const roofs = {
  features: [
    { source_id: 'osm:2', building: 'house', ridge_orientation_deg_from_east_ccw: 0, fit: { winsorized_p10_p95_relief_m: 2.0, tent_r2: 0.95 } },
  ],
};

const enriched = enrichBuildingsForWeb(buildings, surfaces, roofs);
assert.equal(enriched.web_realism.feature_count, 4);
assert.equal(enriched.web_realism.source_height_count, 1);
assert.equal(enriched.web_realism.dom_derived_height_count, 1);
assert.equal(enriched.web_realism.unresolved_fallback_count, 2);
assert.equal(enriched.web_realism.strong_roof_direction_count, 1);
assert.equal(enriched.web_realism.applied_presentation_gable_direction_count, 1);

const source = enriched.features.find((feature) => feature.source_id === 'osm:1');
assert.equal(source.height_m, 6.5, 'OSM source height must win over DOM candidate');
assert.equal(source.height_semantics, 'source-backed-osm');

const derived = enriched.features.find((feature) => feature.source_id === 'osm:2');
assert.equal(derived.height_m, 7.4);
assert.equal(derived.height_semantics, 'derived-nhm-dom-minus-dtm-p90-presentation');
assert.equal(derived.presentation_roof_shape, 'gabled');
assert.equal(derived.presentation_gable_direction_deg_from_east_ccw, 0);
assert.equal(derived.presentation_gable_rise_m, 2);
assert.match(derived.roof_direction_semantics, /derived-high-confidence/);

const rejected = enriched.features.find((feature) => feature.source_id === 'osm:3');
assert.equal(rejected.height_m, null);
assert.equal(rejected.height_semantics, 'unresolved-renderer-fallback');
assert.equal(enriched.web_realism.rejection_counts['above-type-plausibility'], 1);

const missing = enriched.features.find((feature) => feature.source_id === 'osm:4');
assert.equal(missing.height_semantics, 'unresolved-renderer-fallback');
assert.equal(enriched.web_realism.rejection_counts['missing-building-surface'], 1);

const resolvedGeometry = buildBuildingSurfaceGeometry(enriched, {
  resolved: true,
  projectPoint: ([x, z]) => [x, 10, z],
  groundLiftMeters: 0.08,
});
assert.equal(resolvedGeometry.count, 2);
assert.equal(resolvedGeometry.metadata.source_backed_height_count, 1);
assert.equal(resolvedGeometry.metadata.derived_presentation_height_count, 1);
assert.equal(resolvedGeometry.metadata.gabled_presentation_count, 1);
assert.equal(resolvedGeometry.metadata.height_semantics, 'source-backed-or-verified-dom-derived-presentation');
assert.match(resolvedGeometry.metadata.roof_triangulation, /strong-dom-oriented/);
const maxRoofY = Math.max(...Array.from(resolvedGeometry.roofs.positions).filter((_, index) => index % 3 === 1));
assert.ok(Math.abs(maxRoofY - 17.48) < 1e-4, `expected derived total roof height 17.48m local, got ${maxRoofY}`);

const fallbackGeometry = buildBuildingSurfaceGeometry(enriched, {
  resolved: false,
  projectPoint: ([x, z]) => [x, 10, z],
  fallbackHeightMeters: 5,
  groundLiftMeters: 0.08,
});
assert.equal(fallbackGeometry.count, 2);
assert.equal(fallbackGeometry.metadata.fallback_height_count, 2);

console.log('BUILDING_REALISM_ENRICHMENT_PASS');
