import assert from 'node:assert/strict';
import { decodeForgeVegetationSnapshot, FORGE_VEGETATION_SNAPSHOT } from './src/forgeVegetationSnapshot.mjs';
import { buildForgeVegetationPlacement } from './src/forgeVegetationPlacement.mjs';

const decoded = decodeForgeVegetationSnapshot();
assert.equal(FORGE_VEGETATION_SNAPSHOT.source_artifact_sha256, '9b20fdc38c8d672ab5d5e7c089905de477973f383caf2cc571c0e63d7ff75636');
assert.equal(FORGE_VEGETATION_SNAPSHOT.source_semantic_sha256, '320a7e8aadc00fce2ef3912e48f64e279962c5084a89210bca853f506a2f4f1f');
assert.equal(FORGE_VEGETATION_SNAPSHOT.source_evidence_run_id, 32314719935);
assert.equal(decoded.count, 828);
const classCounts = Array.from({ length: 5 }, (_, classId) => Array.from(decoded.classes).filter((value) => value === classId).length);
assert.deepEqual(classCounts, [333, 11, 8, 38, 438], 'compact renderer snapshot must preserve FORGE class counts exactly');
assert.equal(decoded.eastings.length, 828);
assert.equal(decoded.northings.length, 828);
assert.equal(decoded.heights.length, 828);
assert.equal(decoded.yaws.length, 828);

const terrainPayload = {
  elevations: new Float32Array([200, 202, 204, 206]),
  artifact: {
    header: {
      tile_id: FORGE_VEGETATION_SNAPSHOT.tile_id,
      width: 2,
      height: 2,
      bounds: [611000, 6677000, 612000, 6678000],
      pixel_size_m: 500,
      nodata: null,
    },
  },
};
const origin = { e: 611500, n: 6677500, h: 203 };
const placement = buildForgeVegetationPlacement({
  terrainPayload,
  roadsArtifact: { paths: [] },
  buildingsArtifact: { features: [] },
  origin,
});
assert.equal(placement.schema, 'nwe.forge-vegetation-render-placement/0.1');
assert.equal(placement.metadata.authority, 'forge-derived-representative-distribution');
assert.equal(placement.metadata.individual_tree_truth, false);
assert.equal(placement.metadata.placement_xy_semantics, 'forge-deterministic-representatives-not-observed-individual-trees');
assert.equal(placement.metadata.grounding_semantics, 'accepted-dtm-grid-nn2000');
assert.equal(placement.metadata.source_instance_count, 828);
assert.ok(placement.count > 800, 'only the bounded character-spawn clearance should remove representatives in the no-road/no-building fixture');
assert.equal(placement.positions.length, placement.count * 3);
assert.equal(placement.heights.length, placement.count);
assert.equal(placement.yaws.length, placement.count);
assert.equal(placement.species.length, placement.count);
assert.equal(placement.source_classes.length, placement.count);
assert.equal(placement.metadata.conifer_count + placement.metadata.broadleaf_count, placement.count);
assert.ok(Array.from(placement.heights).every((height) => height >= 0.8 && height <= 24));
assert.ok(Array.from(placement.positions).every(Number.isFinite));
assert.ok(Array.from(placement.species).every((value) => value === 0 || value === 1));

const firstE = decoded.eastings[0];
const firstN = decoded.northings[0];
const blocked = buildForgeVegetationPlacement({
  terrainPayload,
  roadsArtifact: { paths: [] },
  buildingsArtifact: {
    features: [{ polygon: [[firstE - 3, firstN - 3], [firstE + 3, firstN - 3], [firstE + 3, firstN + 3], [firstE - 3, firstN + 3], [firstE - 3, firstN - 3]] }],
  },
  origin,
});
assert.ok(blocked.metadata.rejected.building >= 1, 'renderer adapter must clear FORGE representatives from compiled building footprints');

assert.throws(() => buildForgeVegetationPlacement({ terrainPayload: { ...terrainPayload, artifact: { header: { ...terrainPayload.artifact.header, tile_id: 'other' } } }, origin }), /VEGETATION_TILE_MISMATCH/);
console.log(JSON.stringify({ status: 'FORGE_VEGETATION_PLACEMENT_PASS', source: decoded.count, accepted: placement.count, classCounts }));
