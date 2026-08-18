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
    try {
      return await createPreview1WebGpuRenderer({
        ...options,
        graphicsProfile: profile,
      });
    } catch (error) {
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
