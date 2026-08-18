export const GRAPHICS_PROFILE_IDS = Object.freeze(['low', 'balanced', 'high']);
export const RENDERER_PREFERENCES = Object.freeze(['auto', 'webgpu', 'webgl2']);

const PROFILES = Object.freeze({
  low: Object.freeze({
    id: 'low',
    label: 'Lav',
    terrainOutputSize: 65,
    maxDpr: 1,
    msaaSamples: 1,
    webglAntialias: false,
    powerPreference: 'low-power',
    vegetationBudget: 2500,
  }),
  balanced: Object.freeze({
    id: 'balanced',
    label: 'Balansert',
    terrainOutputSize: 129,
    maxDpr: 1.5,
    msaaSamples: 1,
    webglAntialias: true,
    powerPreference: undefined,
    vegetationBudget: 7500,
  }),
  high: Object.freeze({
    id: 'high',
    label: 'Høy',
    terrainOutputSize: 257,
    maxDpr: 2,
    msaaSamples: 4,
    webglAntialias: true,
    powerPreference: 'high-performance',
    vegetationBudget: 20000,
  }),
});

export function resolveGraphicsProfile(value = 'balanced') {
  const id = GRAPHICS_PROFILE_IDS.includes(value) ? value : 'balanced';
  return PROFILES[id];
}

export function resolveRendererPreference(value = 'auto') {
  return RENDERER_PREFERENCES.includes(value) ? value : 'auto';
}
