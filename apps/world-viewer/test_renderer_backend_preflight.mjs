import assert from 'node:assert/strict';
import { resolveCanvasSafeRendererPreference } from './src/rendererBackendPreflight.mjs';

{
  let touched = false;
  const result = await resolveCanvasSafeRendererPreference({
    requestedBackend: 'webgl2',
    gpu: { async requestAdapter() { touched = true; return {}; } },
  });
  assert.equal(touched, false);
  assert.equal(result.backend, 'webgl2');
  assert.equal(result.fallback, null);
}

{
  const result = await resolveCanvasSafeRendererPreference({ requestedBackend: 'auto', gpu: null });
  assert.equal(result.backend, 'webgl2');
  assert.equal(result.fallback.code, 'WEBGPU_UNAVAILABLE');
}

{
  const result = await resolveCanvasSafeRendererPreference({
    requestedBackend: 'auto',
    gpu: { async requestAdapter() { return null; } },
  });
  assert.equal(result.backend, 'webgl2');
  assert.equal(result.fallback.stage, 'adapter-preflight');
  assert.equal(result.fallback.code, 'WEBGPU_ADAPTER_UNAVAILABLE');
}

{
  const result = await resolveCanvasSafeRendererPreference({
    requestedBackend: 'auto',
    gpu: { async requestAdapter() { return { name: 'fake-adapter' }; } },
  });
  assert.equal(result.backend, 'auto');
  assert.equal(result.webgpuAdapterAvailable, true);
  assert.equal(result.fallback, null);
}

{
  await assert.rejects(
    resolveCanvasSafeRendererPreference({ requestedBackend: 'webgpu', gpu: { async requestAdapter() { return null; } } }),
    (error) => error?.code === 'WEBGPU_ADAPTER_UNAVAILABLE',
  );
}

{
  const result = await resolveCanvasSafeRendererPreference({
    requestedBackend: 'auto',
    gpu: { async requestAdapter() { throw new Error('adapter exploded'); } },
  });
  assert.equal(result.backend, 'webgl2');
  assert.equal(result.fallback.code, 'WEBGPU_ADAPTER_REQUEST_FAILED');
}

console.log('renderer backend preflight regressions: PASS');
