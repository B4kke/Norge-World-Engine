const TILE_ID = 'epsg25832_611000_6677000_1000m';
const HORIZONTAL_CRS = 'EPSG:25832';
const BUILDING_ARTIFACT_SHA256 = '678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd';

const BUILDING_RUNTIME_COMMIT = '7a0e49b1743d209bbc2d85af901915e4009e7d7f';
const VEGETATION_RUNTIME_COMMIT = 'c8de691494edb550aa4c43812efdeec3facf24a1';
const RUNTIME_ROOT = 'nannestad-preview-1';

export const NANNESTAD_REALISM_CONTRACT = Object.freeze({
  tile_id: TILE_ID,
  horizontal_crs: HORIZONTAL_CRS,
  building_artifact_sha256: BUILDING_ARTIFACT_SHA256,
  building_surface: Object.freeze({
    schema: 'nwe.building-surface-artifact/0.1-candidate',
    compiler_config_id: 'd80cb89ff57170f0bfd6b341c5c6072654919dc29f81954b7eb52753e6477f15',
    sha256: '7b07c587cbbf3e42685cc53d9751fa04471d247e2ab9601daa26e75a2e13721a',
    fallback_url: `https://raw.githubusercontent.com/B4kke/Norge-World-Engine/${BUILDING_RUNTIME_COMMIT}/${RUNTIME_ROOT}/building-surface.json`,
  }),
  roof_orientation: Object.freeze({
    schema: 'nwe.building-roof-orientation-artifact/0.1-candidate',
    compiler_config_id: '325cd39feca447c9b1a8995d805525ee9abf37359d5089e9df81069c916b8682',
    sha256: '0f6eedb225821da4e0760b96cb843ec01707f99478691c85c8304d847c7270d3',
    fallback_url: `https://raw.githubusercontent.com/B4kke/Norge-World-Engine/${BUILDING_RUNTIME_COMMIT}/${RUNTIME_ROOT}/building-roof-orientation.json`,
  }),
  vegetation: Object.freeze({
    schema: 'nwe.vegetation-representative-artifact/0.1-candidate',
    compiler_config_id: 'f3a3206a559c00196c2a8fc9c397697aae20bef98a25e5e598766fc4de5bd90e',
    semantic_sha256: '320a7e8aadc00fce2ef3912e48f64e279962c5084a89210bca853f506a2f4f1f',
    sha256: 'ceececdf22de88710f7eba4dd7d131a33f123b216bd3ca235e960ca9816c1686',
    fallback_url: `https://raw.githubusercontent.com/B4kke/Norge-World-Engine/${VEGETATION_RUNTIME_COMMIT}/${RUNTIME_ROOT}/vegetation-representatives.json`,
  }),
});

const DEFAULT_PREVIEW1_MANIFEST = 'https://raw.githubusercontent.com/B4kke/Norge-World-Engine/preview-runtime/nannestad-preview-1/manifest.json';

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('NANNESTAD_REALISM_SHA256_UNAVAILABLE');
  return bytesToHex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

function assertResponse(response, url) {
  if (!response?.ok) throw new Error(`NANNESTAD_REALISM_FETCH_FAILED: ${response?.status ?? 'unknown'} ${url}`);
}

async function fetchVerifiedJson({ fetchImpl, url, expectedSha256, label }) {
  const response = await fetchImpl(url, { cache: 'force-cache' });
  assertResponse(response, url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`NANNESTAD_REALISM_SHA256_MISMATCH: ${label} ${actualSha256} != ${expectedSha256}`);
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`NANNESTAD_REALISM_JSON_INVALID: ${label}: ${error?.message ?? error}`);
  }
  return { value, byte_size: bytes.byteLength, sha256: actualSha256, url };
}

function resolvePreviewManifestUrl(explicitUrl = null) {
  if (explicitUrl) return explicitUrl;
  if (globalThis.location?.search) {
    const override = new URLSearchParams(globalThis.location.search).get('previewManifest');
    if (override) return override;
  }
  return DEFAULT_PREVIEW1_MANIFEST;
}

async function fetchManifest({ fetchImpl, manifestUrl }) {
  const response = await fetchImpl(manifestUrl, { cache: 'no-store' });
  assertResponse(response, manifestUrl);
  const manifest = await response.json();
  if (manifest?.schema !== 'nwe.world-preview-manifest/0.1') throw new Error('NANNESTAD_REALISM_MANIFEST_SCHEMA_INVALID');
  if (manifest?.tile?.id !== TILE_ID) throw new Error(`NANNESTAD_REALISM_TILE_MISMATCH: ${manifest?.tile?.id ?? 'missing'}`);
  return manifest;
}

function descriptorUrl(manifestUrl, descriptor, fallbackUrl) {
  if (typeof descriptor?.path === 'string' && descriptor.path) return new URL(descriptor.path, manifestUrl).href;
  return fallbackUrl;
}

function descriptorSha(descriptor, contract) {
  if (typeof descriptor?.artifact_sha256 === 'string') {
    if (descriptor.artifact_sha256 !== contract.sha256) throw new Error('NANNESTAD_REALISM_MANIFEST_ARTIFACT_IDENTITY_MISMATCH');
    return descriptor.artifact_sha256;
  }
  return contract.sha256;
}

function assertCommonArtifact(value, contract, label) {
  if (!value || typeof value !== 'object') throw new Error(`NANNESTAD_REALISM_${label}_NOT_OBJECT`);
  if (value.schema !== contract.schema) throw new Error(`NANNESTAD_REALISM_${label}_SCHEMA_MISMATCH`);
  if (value.tile_id !== TILE_ID) throw new Error(`NANNESTAD_REALISM_${label}_TILE_MISMATCH`);
  if (value.horizontal_crs !== HORIZONTAL_CRS) throw new Error(`NANNESTAD_REALISM_${label}_CRS_MISMATCH`);
  if (value.compiler_config_id !== contract.compiler_config_id) throw new Error(`NANNESTAD_REALISM_${label}_CONFIG_MISMATCH`);
}

function assertBuildingSurface(value) {
  assertCommonArtifact(value, NANNESTAD_REALISM_CONTRACT.building_surface, 'BUILDING_SURFACE');
  if (value?.source?.building_artifact_sha256 !== BUILDING_ARTIFACT_SHA256) throw new Error('NANNESTAD_REALISM_BUILDING_SURFACE_BASE_MISMATCH');
  if (!Array.isArray(value.features) || value.features.length < 100) throw new Error('NANNESTAD_REALISM_BUILDING_SURFACE_FEATURES_INVALID');
}

function assertRoofOrientation(value) {
  assertCommonArtifact(value, NANNESTAD_REALISM_CONTRACT.roof_orientation, 'ROOF_ORIENTATION');
  if (value?.source?.building_artifact_sha256 !== BUILDING_ARTIFACT_SHA256) throw new Error('NANNESTAD_REALISM_ROOF_BASE_MISMATCH');
  if (!Array.isArray(value.features) || value.features.length < 10) throw new Error('NANNESTAD_REALISM_ROOF_FEATURES_INVALID');
}

function assertVegetation(value) {
  assertCommonArtifact(value, NANNESTAD_REALISM_CONTRACT.vegetation, 'VEGETATION');
  if (!Array.isArray(value.instances) || value.instances.length < 100) throw new Error('NANNESTAD_REALISM_VEGETATION_INSTANCES_INVALID');
  if (!Array.isArray(value.segments) || value.segments.length < 10) throw new Error('NANNESTAD_REALISM_VEGETATION_SEGMENTS_INVALID');
  if (value?.stats?.representative_instance_count !== value.instances.length) throw new Error('NANNESTAD_REALISM_VEGETATION_COUNT_MISMATCH');
}

export async function loadNannestadRealismRuntime({ fetchImpl = globalThis.fetch, manifestUrl = null } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('NANNESTAD_REALISM_FETCH_REQUIRED');
  const resolvedManifestUrl = resolvePreviewManifestUrl(manifestUrl);
  const manifest = await fetchManifest({ fetchImpl, manifestUrl: resolvedManifestUrl });
  const layers = manifest.realism_layers ?? {};
  const surfaceDescriptor = layers.building_surface;
  const roofDescriptor = layers.roof_orientation;
  const vegetationDescriptor = layers.vegetation;

  const [surface, roof, vegetation] = await Promise.all([
    fetchVerifiedJson({
      fetchImpl,
      url: descriptorUrl(resolvedManifestUrl, surfaceDescriptor, NANNESTAD_REALISM_CONTRACT.building_surface.fallback_url),
      expectedSha256: descriptorSha(surfaceDescriptor, NANNESTAD_REALISM_CONTRACT.building_surface),
      label: 'building-surface',
    }),
    fetchVerifiedJson({
      fetchImpl,
      url: descriptorUrl(resolvedManifestUrl, roofDescriptor, NANNESTAD_REALISM_CONTRACT.roof_orientation.fallback_url),
      expectedSha256: descriptorSha(roofDescriptor, NANNESTAD_REALISM_CONTRACT.roof_orientation),
      label: 'roof-orientation',
    }),
    fetchVerifiedJson({
      fetchImpl,
      url: descriptorUrl(resolvedManifestUrl, vegetationDescriptor, NANNESTAD_REALISM_CONTRACT.vegetation.fallback_url),
      expectedSha256: descriptorSha(vegetationDescriptor, NANNESTAD_REALISM_CONTRACT.vegetation),
      label: 'vegetation',
    }),
  ]);

  assertBuildingSurface(surface.value);
  assertRoofOrientation(roof.value);
  assertVegetation(vegetation.value);

  return Object.freeze({
    schema: 'nwe.web-nannestad-realism-runtime/0.1',
    tile_id: TILE_ID,
    building_surface: surface.value,
    roof_orientation: roof.value,
    vegetation: vegetation.value,
    transport: Object.freeze({
      manifest_url: resolvedManifestUrl,
      manifest_staged_layers: Boolean(surfaceDescriptor && roofDescriptor && vegetationDescriptor),
      building_surface: Object.freeze({ sha256: surface.sha256, byte_size: surface.byte_size, url: surface.url }),
      roof_orientation: Object.freeze({ sha256: roof.sha256, byte_size: roof.byte_size, url: roof.url }),
      vegetation: Object.freeze({ sha256: vegetation.sha256, byte_size: vegetation.byte_size, url: vegetation.url }),
    }),
  });
}
