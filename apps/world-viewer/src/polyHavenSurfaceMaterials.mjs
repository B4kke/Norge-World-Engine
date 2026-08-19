import * as THREE from 'three/webgpu';

const POLY_HAVEN_LICENSE = 'CC0-1.0';
const POLY_HAVEN_PROVIDER = 'Poly Haven';
const STATIC_ASSET_HOST = 'https://dl.polyhaven.org';

function asset(role, id, name, physicalWidthMeters) {
  const root = `${STATIC_ASSET_HOST}/file/ph-assets/Textures/jpg/1k/${id}`;
  return Object.freeze({
    role,
    id,
    name,
    provider: POLY_HAVEN_PROVIDER,
    license: POLY_HAVEN_LICENSE,
    asset_page_url: `https://polyhaven.com/a/${id}`,
    resolution: '1k',
    physical_width_m: physicalWidthMeters,
    truth_semantics: 'renderer-only-presentation',
    maps: Object.freeze({
      diffuse: Object.freeze({ semantic: 'srgb-color', url: `${root}/${id}_diff_1k.jpg` }),
      normal: Object.freeze({ semantic: 'linear-normal-opengl', url: `${root}/${id}_nor_gl_1k.jpg` }),
    }),
  });
}

export const POLY_HAVEN_SURFACE_ASSETS = Object.freeze({
  terrain: asset('terrain', 'leafy_grass', 'Leafy Grass', 2.0),
  road: asset('road', 'asphalt_02', 'Asphalt 02', 3.0),
  wall: asset('wall', 'painted_plaster_wall', 'Painted Plaster Wall', 2.0),
  roof: asset('roof', 'grey_roof_tiles_02', 'Grey Roof Tiles 02', 1.5),
});

function finiteRepeat(value, role) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => !(Number.isFinite(entry) && entry > 0))) {
    throw new TypeError(`${role} repeat must be positive [u,v]`);
  }
  return [Number(value[0]), Number(value[1])];
}

function configureTexture(texture, { role, mapKind, repeat, anisotropy }) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.colorSpace = mapKind === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.name = `polyhaven:${role}:${mapKind}:1k`;
  texture.needsUpdate = true;
  return texture;
}

function errorCode(error) {
  if (error instanceof Error && error.message) return error.message.slice(0, 180);
  return String(error ?? 'unknown').slice(0, 180);
}

export async function loadPolyHavenSurfaceTextures({
  repeats,
  maxAnisotropy = 4,
  loader = new THREE.TextureLoader(),
} = {}) {
  const anisotropy = Math.max(1, Math.min(8, Number.isFinite(maxAnisotropy) ? Math.floor(maxAnisotropy) : 1));
  const normalizedRepeats = {};
  for (const role of Object.keys(POLY_HAVEN_SURFACE_ASSETS)) {
    normalizedRepeats[role] = finiteRepeat(repeats?.[role] ?? [1, 1], role);
  }

  const textures = Object.fromEntries(Object.keys(POLY_HAVEN_SURFACE_ASSETS).map((role) => [role, {}]));
  const outcomes = [];
  const requests = [];
  for (const [role, descriptor] of Object.entries(POLY_HAVEN_SURFACE_ASSETS)) {
    for (const [mapKind, mapDescriptor] of Object.entries(descriptor.maps)) {
      requests.push((async () => {
        try {
          const texture = await loader.loadAsync(mapDescriptor.url);
          textures[role][mapKind] = configureTexture(texture, {
            role,
            mapKind,
            repeat: normalizedRepeats[role],
            anisotropy,
          });
          outcomes.push({ role, map: mapKind, status: 'loaded', url: mapDescriptor.url });
        } catch (error) {
          textures[role][mapKind] = null;
          outcomes.push({ role, map: mapKind, status: 'failed', url: mapDescriptor.url, error: errorCode(error) });
        }
      })());
    }
  }
  await Promise.all(requests);

  const loaded = outcomes.filter((entry) => entry.status === 'loaded').length;
  const failed = outcomes.length - loaded;
  const snapshot = Object.freeze({
    schema: 'nwe.polyhaven-surface-assets/0.1',
    provider: POLY_HAVEN_PROVIDER,
    license: POLY_HAVEN_LICENSE,
    runtime_dependency: 'static-renderer-asset-download',
    world_truth: false,
    resolution: '1k',
    requested_texture_count: outcomes.length,
    loaded_texture_count: loaded,
    failed_texture_count: failed,
    anisotropy,
    assets: Object.freeze(Object.fromEntries(Object.entries(POLY_HAVEN_SURFACE_ASSETS).map(([role, descriptor]) => [role, Object.freeze({
      id: descriptor.id,
      name: descriptor.name,
      asset_page_url: descriptor.asset_page_url,
      physical_width_m: descriptor.physical_width_m,
      repeat: Object.freeze([...normalizedRepeats[role]]),
      maps: Object.freeze(Object.fromEntries(outcomes.filter((entry) => entry.role === role).map((entry) => [entry.map, entry.status]))),
    })]))),
    failures: Object.freeze(outcomes.filter((entry) => entry.status === 'failed').map((entry) => Object.freeze({ role: entry.role, map: entry.map, error: entry.error }))),
  });

  return {
    textures,
    snapshot,
    dispose() {
      const unique = new Set();
      for (const roleTextures of Object.values(textures)) {
        for (const texture of Object.values(roleTextures)) if (texture && !unique.has(texture)) { unique.add(texture); texture.dispose(); }
      }
    },
  };
}
