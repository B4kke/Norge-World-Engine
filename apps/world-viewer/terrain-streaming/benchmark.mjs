import { loadTerrainRuntimeInput } from '../terrain_runtime_input.mjs';
import { runTerrainStreamingExperiment } from './experiment.mjs';

const statusEl = document.querySelector('#status');
const metricsEl = document.querySelector('#metrics');
const canvas = document.querySelector('#gl');
const params = new URLSearchParams(location.search);
const autorun = params.get('autorun') === '1';
const bundleUrl = params.get('bundle') || '/runtime/terrain.bundle.json';

async function run() {
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('benchmark canvas is missing');
  const tileId = params.get('tileId');
  const centerE = Number(params.get('centerE'));
  const centerN = Number(params.get('centerN'));
  if (!tileId) throw new Error('tileId query parameter is required');
  if (!Number.isFinite(centerE) || !Number.isFinite(centerN)) {
    throw new Error('centerE/centerN query parameters are required');
  }

  const result = await runTerrainStreamingExperiment({
    canvas,
    tile: { id: tileId, centerE, centerN },
    resolveRuntimeInput: (tile, { signal }) => loadTerrainRuntimeInput({
      bundleUrl,
      expectedTileId: tile.id,
      signal,
    }),
    onPhase: (phase) => { statusEl.textContent = phase.toUpperCase(); },
  });

  const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
  const rawSourceCalls = resources.filter((url) => /(geonorge|kartverket|vegvesen|nvdb|overpass|openstreetmap)/i.test(url)).length;
  const runtimeRequests = resources.filter((url) => url.includes('/runtime/')).length;
  if (rawSourceCalls !== 0) throw new Error(`raw source network calls detected: ${rawSourceCalls}`);
  if (runtimeRequests !== 2) throw new Error(`expected bundle + compiled artifact runtime requests, got ${runtimeRequests}`);
  if (result.resolver_calls !== 1) throw new Error(`expected one terrain resolver call, got ${result.resolver_calls}`);

  const proof = {
    ...result,
    network: {
      resource_requests: resources.length,
      raw_source_calls: rawSourceCalls,
      runtime_bundle_artifact_requests: runtimeRequests,
      terrain_resolver_calls: result.resolver_calls,
    },
  };
  statusEl.textContent = 'PASS';
  metricsEl.textContent = JSON.stringify(proof, null, 2);
  if (autorun) {
    await fetch('/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(proof),
    });
  }
  return proof;
}

run().catch(async (error) => {
  const result = {
    schema: 'nwe.browser-terrain-worker-streaming-proof/0.3',
    status: 'FAIL',
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
  statusEl.textContent = 'FAIL';
  metricsEl.textContent = JSON.stringify(result, null, 2);
  if (autorun) {
    try {
      await fetch('/result', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result),
      });
    } catch {}
  }
  console.error(error);
});
