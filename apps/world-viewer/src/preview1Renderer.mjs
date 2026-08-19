import { resolveGraphicsProfile, resolveRendererPreference } from './graphicsProfiles.mjs';
import { loadPreviewEnvironment } from './previewEnvironment.mjs';
import { createThreeGroundRenderer } from './threeGroundRenderer.mjs';

function normalizeRendererInterface(renderer) {
  if (!renderer) return renderer;
  const invalidate = typeof renderer.invalidate === 'function' ? renderer.invalidate.bind(renderer) : null;
  const dispose = typeof renderer.dispose === 'function' ? renderer.dispose.bind(renderer) : null;
  if (!invalidate || !dispose) throw new Error('PREVIEW1_RENDERER_INTERFACE_INVALID');
  return { ...renderer, invalidate, dispose };
}

export async function createPreview1Renderer({
  backend = 'auto',
  graphicsProfile = 'balanced',
  environment = null,
  onBackendFallback = () => {},
  ...options
} = {}) {
  const rendererPreference = resolveRendererPreference(backend);
  const profile = typeof graphicsProfile === 'string'
    ? resolveGraphicsProfile(graphicsProfile)
    : graphicsProfile;
  const resolvedEnvironment = environment ?? await loadPreviewEnvironment();

  const renderer = await createThreeGroundRenderer({
    ...options,
    environment: resolvedEnvironment,
    graphicsProfile: profile,
    backend: rendererPreference,
    onBackendFallback,
  });
  return normalizeRendererInterface(renderer);
}
