import { loadTerrainRuntimeInput } from '../terrain_runtime_input.mjs';
import { runTerrainStreamingExperiment } from './experiment.mjs';

const statusEl = document.querySelector('#status');
const metricsEl = document.querySelector('#metrics');
const canvas = document.querySelector('#gl');
const params = new URLSearchParams(location.search);
const autorun = params.get('autorun') === '1';
const bundleUrl = params.get('bundle') || '/runtime/terrain.bundle.json';

function assertGpuResourceLifecycle(result) {
  if (result.renderer_resource_lifecycle_observed !== true) {
    throw new Error('renderer GPU resource lifecycle was not observed');
  }
  const lifecycle = result.gpu_resource_lifecycle;
  if (!lifecycle || lifecycle.backend !== 'webgl2') {
    throw new Error(`unexpected GPU resource lifecycle backend: ${lifecycle?.backend ?? 'missing'}`);
  }
  if (lifecycle.contract !== 'resident-resource -> cached-no-resource -> cache-hit-recreated-resource') {
    throw new Error(`unexpected GPU resource lifecycle contract: ${lifecycle.contract ?? 'missing'}`);
  }
  const checkpoints = Object.fromEntries((lifecycle.checkpoints ?? []).map((item) => [item.label, item]));
  const initial = checkpoints['initial-resident'];
  const cached = checkpoints['outside-active-inside-retain'];
  const returned = checkpoints['returned-center'];
  if (!initial?.gpu_resource_present || initial.active_resource_sets !== 1) {
    throw new Error(`initial resident GPU resource missing: ${JSON.stringify(initial)}`);
  }
  if (cached?.gpu_resource_present !== false || cached?.active_resource_sets !== 0) {
    throw new Error(`cached tile retained GPU resource: ${JSON.stringify(cached)}`);
  }
  if (!returned?.gpu_resource_present || returned.active_resource_sets !== 1) {
    throw new Error(`cache-hit GPU resource was not recreated: ${JSON.stringify(returned)}`);
  }
  if (lifecycle.activations !== 2 || lifecycle.deactivations !== 1) {
    throw new Error(`unexpected GPU lifecycle activation/deactivation counts: ${JSON.stringify(lifecycle)}`);
  }
  if (lifecycle.resource_sets_created !== 2 || lifecycle.resource_sets_destroyed !== 1) {
    throw new Error(`unexpected GPU lifecycle create/destroy counts: ${JSON.stringify(lifecycle)}`);
  }
  if (lifecycle.peak_active_resource_sets !== 1 || lifecycle.cache_reactivation_without_refetch !== true) {
    throw new Error(`GPU lifecycle cache reactivation contract failed: ${JSON.stringify(lifecycle)}`);
  }
}

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
  assertGpuResourceLifecycle(result);

  const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
  const rawSourceCalls = resources.filter((url) => /(geonorge|kartverket|vegvesen|nvdb|overpass|openstreetmap)/i.test(url)).length;
  const runtimeRequests = resources.filter((url) => url.includes('/runtime/')).length;
  if (rawSourceCalls !== 0) throw new Error(`raw source network calls detected: ${rawSourceCalls}`);
  if (runtimeRequests !== 2) throw new Error(`expected bundle + compiled artifact runtime requests, got ${runtimeRequests}`);
  if (result.resolver_calls !== 1) throw new Error(`expected one terrain resolver call, got ${result.resolver_calls}`);

  const proof = {
    ...result,
    gpu_resource_lifecycle: {
      ...result.gpu_resource_lifecycle,
      physical_vram_release_observed: false,
      claim_boundary: 'WebGL deleteBuffer/deleteVertexArray calls and renderer ownership removal are observed; physical driver/VRAM reclamation timing is not observable here.',
    },
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
    schema: 'nwe.browser-terrain-worker-streaming-proof/0.4',
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
