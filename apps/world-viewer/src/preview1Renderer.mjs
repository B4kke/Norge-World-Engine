import { resolveGraphicsProfile, resolveRendererPreference } from './graphicsProfiles.mjs';
import { createPreview1WebGl2Renderer } from './preview1WebGl2Renderer.mjs';
import { createPreview1WebGpuRenderer } from './preview1WebGpuRenderer.mjs';

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
      return webGpuRenderer;
    } catch (error) {
      webGpuRenderer?.dispose?.();
      if (rendererPreference === 'webgpu') throw error;
      onBackendFallback({ from: 'webgpu', to: 'webgl2', error });
    }
  } else if (rendererPreference === 'webgpu') {
    throw new Error('WEBGPU_UNAVAILABLE');
  }

  return createPreview1WebGl2Renderer({
    ...options,
    graphicsProfile: profile,
  });
}
