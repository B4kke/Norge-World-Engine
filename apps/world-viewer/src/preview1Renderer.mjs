import { resolveGraphicsProfile, resolveRendererPreference } from './graphicsProfiles.mjs';
import { createPreview1WebGl2Renderer } from './preview1WebGl2Renderer.mjs';
import { createPreview1WebGpuRenderer } from './preview1WebGpuRenderer.mjs';

function normalizeRendererInterface(renderer) {
  if (!renderer) return renderer;
  const invalidate = typeof renderer.invalidate === 'function'
    ? renderer.invalidate.bind(renderer)
    : typeof renderer.drawForBenchmark === 'function'
      ? renderer.drawForBenchmark.bind(renderer)
      : null;
  const dispose = typeof renderer.dispose === 'function'
    ? renderer.dispose.bind(renderer)
    : typeof renderer.stop === 'function'
      ? renderer.stop.bind(renderer)
      : null;
  if (!invalidate || !dispose) {
    throw new Error('PREVIEW1_RENDERER_INTERFACE_INVALID');
  }
  return {
    ...renderer,
    invalidate,
    dispose,
  };
}

function disposeRenderer(renderer) {
  if (typeof renderer?.dispose === 'function') renderer.dispose();
  else renderer?.stop?.();
}

export async function createPreview1Renderer({
  backend = 'auto',
  graphicsProfile = 'balanced',
  onBackendFallback = () => {},
  ...options
} = {}) {
  const rendererPreference = resolveRendererPreference(backend);
  const profile = typeof graphicsProfile === 'string'
    ? resolveGraphicsProfile(graphicsProfile)
    : graphicsProfile;

  const webGpuAvailable = Boolean(globalThis.navigator?.gpu);
  if (rendererPreference !== 'webgl2' && webGpuAvailable) {
    let webGpuRenderer = null;
    try {
      webGpuRenderer = await createPreview1WebGpuRenderer({
        ...options,
        graphicsProfile: profile,
      });
      // A device/context that exists but cannot submit the real first frame is not
      // a usable Preview 1 backend. Auto mode must fall back before READY.
      await webGpuRenderer.firstFrame;
      return normalizeRendererInterface(webGpuRenderer);
    } catch (error) {
      disposeRenderer(webGpuRenderer);
      if (rendererPreference === 'webgpu') throw error;
      onBackendFallback({ from: 'webgpu', to: 'webgl2', error });
    }
  } else if (rendererPreference === 'webgpu') {
    throw new Error('WEBGPU_UNAVAILABLE');
  }

  return normalizeRendererInterface(createPreview1WebGl2Renderer({
    ...options,
    graphicsProfile: profile,
  }));
}
