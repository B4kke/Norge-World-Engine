import { buildSyntheticTerrainRuntimeFixture } from '../terrain_fixture.mjs';
import { loadTerrainRuntimeInput } from '../terrain_runtime_input.mjs';
import { runTerrainStreamingExperiment } from '../terrain-streaming/experiment.mjs';

function centerFromBounds(bounds) {
  return {
    centerE: (bounds[0] + bounds[2]) / 2,
    centerN: (bounds[1] + bounds[3]) / 2,
  };
}

export async function runWorldViewerTerrainExperiment({
  canvas,
  bundleUrl = null,
  tileId = null,
  centerE = null,
  centerN = null,
  onPhase = () => {},
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');

  if (bundleUrl) {
    if (!tileId || !Number.isFinite(centerE) || !Number.isFinite(centerN)) {
      throw new Error('REAL_TERRAIN_PARAMS_REQUIRED: terrainTileId, centerE and centerN are required with terrainBundle');
    }
    const result = await runTerrainStreamingExperiment({
      canvas,
      tile: { id: tileId, centerE, centerN },
      resolveRuntimeInput: (tile, { signal }) => loadTerrainRuntimeInput({
        bundleUrl,
        expectedTileId: tile.id,
        signal,
      }),
      onPhase,
    });
    return {
      ...result,
      input_mode: 'real-runtime-bundle',
      fixture_prep_ms: null,
      bundle_url: bundleUrl,
    };
  }

  onPhase('fixture-prep');
  const fixture = await buildSyntheticTerrainRuntimeFixture();
  const center = centerFromBounds(fixture.header.bounds);
  const result = await runTerrainStreamingExperiment({
    canvas,
    tile: {
      id: fixture.header.tile_id,
      centerE: center.centerE,
      centerN: center.centerN,
    },
    resolveRuntimeInput: async () => ({
      bundle: fixture.bundle,
      artifactRef: fixture.bundle.artifact_ref,
      artifactBytes: fixture.artifactBytes,
      artifactUrl: 'fixture://compiled/terrain.nwehgt',
    }),
    onPhase,
  });
  return {
    ...result,
    input_mode: 'synthetic-structural-fixture',
    fixture_prep_ms: Math.round(fixture.prepTimingMs * 1000) / 1000,
    warning: 'Synthetic geometry is a structural runtime test and is not Nannestad world truth.',
  };
}
