function webGpuError(code, cause = null) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export async function resolveCanvasSafeRendererPreference({
  requestedBackend = 'auto',
  gpu = globalThis.navigator?.gpu,
} = {}) {
  if (!['auto', 'webgpu', 'webgl2'].includes(requestedBackend)) {
    throw new TypeError(`unsupported renderer backend: ${requestedBackend}`);
  }

  if (requestedBackend === 'webgl2') {
    return { backend: 'webgl2', fallback: null, webgpuAdapterAvailable: false };
  }

  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    if (requestedBackend === 'webgpu') throw webGpuError('WEBGPU_UNAVAILABLE');
    return {
      backend: 'webgl2',
      fallback: { from: 'webgpu', to: 'webgl2', stage: 'adapter-preflight', code: 'WEBGPU_UNAVAILABLE' },
      webgpuAdapterAvailable: false,
    };
  }

  let adapter;
  try {
    adapter = await gpu.requestAdapter();
  } catch (cause) {
    if (requestedBackend === 'webgpu') throw webGpuError('WEBGPU_ADAPTER_REQUEST_FAILED', cause);
    return {
      backend: 'webgl2',
      fallback: { from: 'webgpu', to: 'webgl2', stage: 'adapter-preflight', code: 'WEBGPU_ADAPTER_REQUEST_FAILED' },
      webgpuAdapterAvailable: false,
    };
  }

  if (!adapter) {
    if (requestedBackend === 'webgpu') throw webGpuError('WEBGPU_ADAPTER_UNAVAILABLE');
    return {
      backend: 'webgl2',
      fallback: { from: 'webgpu', to: 'webgl2', stage: 'adapter-preflight', code: 'WEBGPU_ADAPTER_UNAVAILABLE' },
      webgpuAdapterAvailable: false,
    };
  }

  return {
    backend: requestedBackend === 'webgpu' ? 'webgpu' : 'auto',
    fallback: null,
    webgpuAdapterAvailable: true,
  };
}
