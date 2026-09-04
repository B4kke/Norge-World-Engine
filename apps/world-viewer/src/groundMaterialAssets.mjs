import * as THREE from 'three/webgpu';

export const GROUND_MATERIAL_CATALOG_SCHEMA = 'nwe.polyhaven-material-catalog/0.1';
export const GROUND_MATERIAL_LIBRARY_SCHEMA = 'nwe.ground-material-library/0.1';
export const GROUND_MATERIAL_CATALOG_PATH = 'assets/materials/polyhaven/manifest.json';

const REQUIRED_SURFACES = Object.freeze([
  'terrain',
  'road_asphalt',
  'building_walls',
  'building_roofs',
]);
const REQUIRED_MAPS = Object.freeze(['diffuse', 'normal_gl', 'normal_dx', 'roughness']);

function catalogUrl() {
  const base = import.meta.env?.BASE_URL ?? '/';
  return new URL(GROUND_MATERIAL_CATALOG_PATH, new URL(base, globalThis.location?.href ?? 'http://localhost/')).href;
}

function assertDigest(value, algorithm, surfaceId, mapId) {
  const length = algorithm === 'sha256' ? 64 : 32;
  if (typeof value !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) {
    throw new Error(`GROUND_MATERIAL_${algorithm.toUpperCase()}_INVALID: ${surfaceId}/${mapId}`);
  }
}

export function validateGroundMaterialCatalog(catalog) {
  if (catalog?.schema !== GROUND_MATERIAL_CATALOG_SCHEMA) {
    throw new Error(`GROUND_MATERIAL_CATALOG_SCHEMA_INVALID: ${catalog?.schema ?? 'missing'}`);
  }
  if (catalog.license !== 'CC0-1.0' || catalog.runtime_policy !== 'same-origin-local-assets-only') {
    throw new Error('GROUND_MATERIAL_CATALOG_POLICY_INVALID');
  }
  for (const surfaceId of REQUIRED_SURFACES) {
    const surface = catalog.assets?.[surfaceId];
    if (!surface || typeof surface.asset_id !== 'string' || !surface.asset_id) {
      throw new Error(`GROUND_MATERIAL_SURFACE_MISSING: ${surfaceId}`);
    }
    if (!(Number.isFinite(surface.tile_size_m) && surface.tile_size_m > 0)) {
      throw new Error(`GROUND_MATERIAL_TILE_SIZE_INVALID: ${surfaceId}`);
    }
    for (const mapId of REQUIRED_MAPS) {
      const map = surface.maps?.[mapId];
      if (!map || typeof map.path !== 'string' || !map.path.endsWith('.jpg')
        || map.path.includes('..') || map.path.startsWith('/') || map.path.includes('://')) {
        throw new Error(`GROUND_MATERIAL_MAP_INVALID: ${surfaceId}/${mapId}`);
      }
      if (!(Number.isInteger(map.byte_size) && map.byte_size > 0)) {
        throw new Error(`GROUND_MATERIAL_BYTE_SIZE_INVALID: ${surfaceId}/${mapId}`);
      }
      assertDigest(map.md5, 'md5', surfaceId, mapId);
      assertDigest(map.sha256, 'sha256', surfaceId, mapId);
    }
  }
  return catalog;
}

function configureTexture(texture, { color = false, repeat = [1, 1], anisotropy = 1 } = {}) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function maxSupportedAnisotropy(renderer, requested) {
  const supported = Number(
    renderer?.getMaxAnisotropy?.()
      ?? renderer?.capabilities?.getMaxAnisotropy?.(),
  );
  return Math.max(1, Math.min(requested, Number.isFinite(supported) && supported > 0 ? supported : 1));
}

async function loadSurfaceTextures(loader, manifestUrl, surface, options) {
  const entries = [
    ['diffuse', true],
    ...(options.normalMaps === false ? [] : [['normal_gl', false]]),
    ['roughness', false],
  ];
  const loaded = await Promise.all(entries.map(async ([mapId, color]) => {
    const textureUrl = new URL(surface.maps[mapId].path, manifestUrl).href;
    const texture = await loader.loadAsync(textureUrl);
    texture.name = `${surface.asset_id}:${mapId}`;
    return [mapId, configureTexture(texture, { ...options, color })];
  }));
  return Object.fromEntries(loaded);
}

function materialOptions(textures, profile, options = {}) {
  return {
    map: textures.diffuse,
    normalMap: profile.normalMaps === false ? null : textures.normal_gl,
    roughnessMap: textures.roughness,
    roughness: options.roughness ?? 1,
    metalness: options.metalness ?? 0,
    color: options.color ?? 0xffffff,
    normalScale: new THREE.Vector2(options.normalScale ?? 0.55, options.normalScale ?? 0.55),
    side: options.side ?? THREE.FrontSide,
    vertexColors: options.vertexColors === true,
  };
}

export async function createGroundMaterialLibrary({
  renderer,
  profile,
  terrainExtentM = [1000, 1000],
  fetchImpl = globalThis.fetch,
  textureLoader = new THREE.TextureLoader(),
  manifestUrl = catalogUrl(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  if (!profile?.id) throw new TypeError('graphics profile is required');
  const resolvedManifestUrl = new URL(manifestUrl, globalThis.location?.href ?? 'http://localhost/');
  if (globalThis.location?.origin && resolvedManifestUrl.origin !== globalThis.location.origin) {
    throw new Error('GROUND_MATERIAL_CATALOG_CROSS_ORIGIN_FORBIDDEN');
  }
  const response = await fetchImpl(resolvedManifestUrl.href, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`GROUND_MATERIAL_CATALOG_FETCH_FAILED: HTTP ${response.status}`);
  if (response.url && new URL(response.url).origin !== resolvedManifestUrl.origin) {
    throw new Error('GROUND_MATERIAL_CATALOG_REDIRECT_FORBIDDEN');
  }
  const catalog = validateGroundMaterialCatalog(await response.json());
  const requestedAnisotropy = Math.max(1, Number(profile.textureAnisotropy) || 1);
  const anisotropy = maxSupportedAnisotropy(renderer, requestedAnisotropy);
  const terrain = catalog.assets.terrain;
  const terrainRepeat = [
    Math.max(1, terrainExtentM[0] / terrain.tile_size_m),
    Math.max(1, terrainExtentM[1] / terrain.tile_size_m),
  ];

  const [terrainTextures, roadTextures, wallTextures, roofTextures] = await Promise.all([
    loadSurfaceTextures(textureLoader, resolvedManifestUrl, terrain, { repeat: terrainRepeat, anisotropy, normalMaps: profile.normalMaps }),
    loadSurfaceTextures(textureLoader, resolvedManifestUrl, catalog.assets.road_asphalt, { anisotropy, normalMaps: profile.normalMaps }),
    loadSurfaceTextures(textureLoader, resolvedManifestUrl, catalog.assets.building_walls, { anisotropy, normalMaps: profile.normalMaps }),
    loadSurfaceTextures(textureLoader, resolvedManifestUrl, catalog.assets.building_roofs, { anisotropy, normalMaps: profile.normalMaps }),
  ]);

  const materials = {
    terrain: new THREE.MeshStandardMaterial(materialOptions(terrainTextures, profile, {
      normalScale: 0.42,
      roughness: 0.98,
      vertexColors: true,
    })),
    roadAsphalt: new THREE.MeshStandardMaterial(materialOptions(roadTextures, profile, {
      normalScale: 0.58,
      roughness: 0.94,
      color: 0xc8c9c8,
      side: THREE.DoubleSide,
    })),
    resolvedWall: new THREE.MeshStandardMaterial(materialOptions(wallTextures, profile, {
      normalScale: 0.62,
      roughness: 0.92,
      color: 0xe5ded1,
      side: THREE.DoubleSide,
    })),
    fallbackWall: new THREE.MeshStandardMaterial(materialOptions(wallTextures, profile, {
      normalScale: 0.48,
      roughness: 0.96,
      color: 0x909897,
      side: THREE.DoubleSide,
    })),
    resolvedRoof: new THREE.MeshStandardMaterial(materialOptions(roofTextures, profile, {
      normalScale: 0.58,
      roughness: 0.92,
      color: 0xd2d5d6,
      side: THREE.DoubleSide,
    })),
    fallbackRoof: new THREE.MeshStandardMaterial(materialOptions(roofTextures, profile, {
      normalScale: 0.44,
      roughness: 0.97,
      color: 0x858d90,
      side: THREE.DoubleSide,
    })),
  };
  for (const [id, material] of Object.entries(materials)) material.name = `NWE:${id}:${profile.id}`;

  const textures = [
    ...Object.values(terrainTextures),
    ...Object.values(roadTextures),
    ...Object.values(wallTextures),
    ...Object.values(roofTextures),
  ];
  const localTextureBytes = REQUIRED_SURFACES.reduce((sum, surfaceId) => (
    sum + ['diffuse', ...(profile.normalMaps === false ? [] : ['normal_gl']), 'roughness'].reduce(
      (surfaceSum, mapId) => surfaceSum + catalog.assets[surfaceId].maps[mapId].byte_size,
      0,
    )
  ), 0);

  const stats = Object.freeze({
    schema: GROUND_MATERIAL_LIBRARY_SCHEMA,
    license: catalog.license,
    runtime_policy: catalog.runtime_policy,
    source: 'Poly Haven local pinned CC0 catalog',
    texture_resolution: catalog.texture_resolution,
    texture_count: textures.length,
    local_compressed_texture_bytes: localTextureBytes,
    anisotropy_requested: requestedAnisotropy,
    anisotropy_active: anisotropy,
    normal_maps: profile.normalMaps !== false,
    normal_convention: 'OpenGL',
    terrain_repeat: Object.freeze(terrainRepeat),
    assets: Object.freeze(Object.fromEntries(REQUIRED_SURFACES.map((id) => [id, catalog.assets[id].asset_id]))),
  });

  return {
    materials,
    stats,
    dispose() {
      for (const material of Object.values(materials)) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
