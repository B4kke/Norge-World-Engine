const MIN_SAMPLES = 8;
const MIN_P90_M = 2.2;

const MAX_P90_BY_TYPE = Object.freeze({
  garage: 8,
  garages: 8,
  shed: 8,
  farm_auxiliary: 10,
  house: 18,
  detached: 18,
  residential: 18,
  terrace: 18,
  kindergarten: 18,
  yes: 18,
  apartments: 22,
  farm: 20,
  barn: 20,
  warehouse: 22,
  industrial: 22,
  civic: 25,
  school: 25,
  sports_centre: 25,
  office: 25,
});

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function unclaspPolygon(polygon) {
  if (!Array.isArray(polygon)) return [];
  const points = polygon.filter((point) => Array.isArray(point) && point.length >= 2);
  if (points.length > 3) {
    const first = points[0];
    const last = points.at(-1);
    if (Number(first[0]) === Number(last[0]) && Number(first[1]) === Number(last[1])) return points.slice(0, -1);
  }
  return points;
}

function presentationRoofShape(feature) {
  const type = String(feature?.building ?? 'yes').toLowerCase();
  const vertices = unclaspPolygon(feature?.polygon).length;
  const area = finitePositive(feature?.footprint_area_m2) ?? Number.POSITIVE_INFINITY;
  if (['garage', 'garages', 'warehouse', 'industrial'].includes(type)) return 'flat';
  if (vertices === 4 && (
    ['house', 'detached', 'residential', 'farm', 'barn', 'farm_auxiliary', 'terrace'].includes(type)
    || area <= 650
  )) return 'gabled';
  if (area <= 300) return 'hipped';
  return 'flat';
}

function deriveHeight(surfaceFeature) {
  const samples = Number(surfaceFeature?.sample_count);
  if (!Number.isInteger(samples) || samples < MIN_SAMPLES) return { height_m: null, reason: 'insufficient-samples' };
  const p90 = finitePositive(surfaceFeature?.height_delta_m?.p90);
  if (p90 === null) return { height_m: null, reason: 'missing-p90' };
  const type = String(surfaceFeature?.building ?? 'yes').toLowerCase();
  const ceiling = MAX_P90_BY_TYPE[type] ?? 18;
  if (p90 < MIN_P90_M) return { height_m: null, reason: 'below-minimum-height' };
  if (p90 > ceiling) return { height_m: null, reason: 'above-type-plausibility' };
  return {
    height_m: p90,
    roof_relief_m: finitePositive(surfaceFeature?.roof_relief_p95_p25_m),
    reason: null,
  };
}

export function enrichBuildingsForWeb(buildingsArtifact, buildingSurfaceArtifact, roofOrientationArtifact) {
  if (!Array.isArray(buildingsArtifact?.features)) throw new TypeError('BUILDING_REALISM_BASE_FEATURES_REQUIRED');
  if (!Array.isArray(buildingSurfaceArtifact?.features)) throw new TypeError('BUILDING_REALISM_SURFACE_FEATURES_REQUIRED');
  if (!Array.isArray(roofOrientationArtifact?.features)) throw new TypeError('BUILDING_REALISM_ROOF_FEATURES_REQUIRED');

  const surfaces = new Map(buildingSurfaceArtifact.features.map((feature) => [feature.source_id, feature]));
  const roofs = new Map(roofOrientationArtifact.features.map((feature) => [feature.source_id, feature]));
  const rejectionCounts = {};
  let osmHeightCount = 0;
  let domHeightCount = 0;
  let fallbackHeightCount = 0;
  let strongRoofDirectionCount = 0;
  let appliedPresentationGableDirectionCount = 0;

  const features = buildingsArtifact.features.map((feature) => {
    const copy = { ...feature };
    const sourceId = copy.source_id;
    const sourceHeight = finitePositive(copy.height_m);
    const surface = surfaces.get(sourceId);
    const roof = roofs.get(sourceId);
    const roofShape = presentationRoofShape({ ...copy, footprint_area_m2: surface?.footprint_area_m2 });

    copy.presentation_roof_shape = roofShape;
    copy.presentation_roof_shape_semantics = 'renderer-policy-not-surveyed-roof-shape';

    if (sourceHeight !== null) {
      osmHeightCount += 1;
      copy.height_semantics = 'source-backed-osm';
    } else if (surface) {
      const derived = deriveHeight(surface);
      if (derived.height_m !== null) {
        copy.height_m = derived.height_m;
        copy.height_semantics = 'derived-nhm-dom-minus-dtm-p90-presentation';
        copy.height_sample_count = surface.sample_count;
        copy.height_surface_source_id = surface.source_id;
        copy.roof_relief_m = derived.roof_relief_m;
        domHeightCount += 1;
      } else {
        fallbackHeightCount += 1;
        rejectionCounts[derived.reason] = (rejectionCounts[derived.reason] ?? 0) + 1;
        copy.height_semantics = 'unresolved-renderer-fallback';
      }
    } else {
      fallbackHeightCount += 1;
      rejectionCounts['missing-building-surface'] = (rejectionCounts['missing-building-surface'] ?? 0) + 1;
      copy.height_semantics = 'unresolved-renderer-fallback';
    }

    if (roof) {
      strongRoofDirectionCount += 1;
      copy.roof_ridge_orientation_deg_from_east_ccw = Number(roof.ridge_orientation_deg_from_east_ccw);
      copy.roof_direction_semantics = 'derived-high-confidence-dom-tent-fit-not-surveyed-ridge';
      copy.roof_fit = { ...roof.fit };
      if (roofShape === 'gabled' && unclaspPolygon(copy.polygon).length === 4) {
        copy.presentation_gable_direction_deg_from_east_ccw = copy.roof_ridge_orientation_deg_from_east_ccw;
        copy.presentation_gable_rise_m = finitePositive(roof?.fit?.winsorized_p10_p95_relief_m)
          ?? finitePositive(copy.roof_relief_m)
          ?? 1.5;
        copy.presentation_gable_semantics = 'renderer-gable-profile-oriented-by-strong-dom-derived-direction';
        appliedPresentationGableDirectionCount += 1;
      }
    }

    return copy;
  });

  const featureCount = features.length;
  if (osmHeightCount + domHeightCount + fallbackHeightCount !== featureCount) {
    throw new Error('BUILDING_REALISM_HEIGHT_ACCOUNTING_MISMATCH');
  }

  return {
    ...buildingsArtifact,
    features,
    web_realism: {
      schema: 'nwe.web-building-realism/0.1',
      feature_count: featureCount,
      source_height_count: osmHeightCount,
      dom_derived_height_count: domHeightCount,
      unresolved_fallback_count: fallbackHeightCount,
      strong_roof_direction_count: strongRoofDirectionCount,
      applied_presentation_gable_direction_count: appliedPresentationGableDirectionCount,
      rejection_counts: rejectionCounts,
      height_policy: 'OSM height wins; else NHM DOM-DTM p90 with >=8 samples, >=2.2m and conservative type ceiling; else explicit fallback',
      roof_policy: 'DOM direction only orients an already renderer-policy gable; no surveyed roof-shape claim',
    },
  };
}
