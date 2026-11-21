const TILE_ID = 'epsg25832_611000_6677000_1000m';
const HORIZONTAL_CRS = 'EPSG:25832';
const BUILDING_ARTIFACT_SHA256 = '678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd';

const BUILDING_RUNTIME_COMMIT = '7a0e49b1743d209bbc2d85af901915e4009e7d7f';
const VEGETATION_RUNTIME_COMMIT = 'c8de691494edb550aa4c43812efdeec3facf24a1';
const RUNTIME_ROOT = 'nannestad-preview-1';
const SVV_VIKEPLIKT_ARCHIVE_SHA256 = '4333750af2929d0e7e359457b837351fe8b51dc1638fe963804902dd514c1b28';

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
  road_realism: Object.freeze({
    schema: 'nwe.road-realism-artifact/0.1-candidate',
    compiler_algorithm: 'nvdb-838-primary-583-nonoverlap-fallback-241-surface-v0.1',
  }),
  street_detail: Object.freeze({
    schema: 'nwe.nvdb-street-detail-artifact/0.1-candidate',
    compiler_algorithm: 'nvdb-v4-explicit-geometry-street-detail-v0.5',
  }),
  sign_artwork: Object.freeze({
    schema: 'nwe.svv-sign-artwork-runtime-manifest/0.1',
    license_profile: 'NLOD-1.0',
    source_archive_sha256: SVV_VIKEPLIKT_ARCHIVE_SHA256,
    admitted_sign_codes: Object.freeze(['202', '206']),
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

async function fetchVerifiedBytes({ fetchImpl, url, expectedSha256, expectedByteSize = null, label }) {
  const response = await fetchImpl(url, { cache: 'force-cache' });
  assertResponse(response, url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (Number.isInteger(expectedByteSize) && bytes.byteLength !== expectedByteSize) {
    throw new Error(`NANNESTAD_REALISM_BYTE_SIZE_MISMATCH: ${label} ${bytes.byteLength} != ${expectedByteSize}`);
  }
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`NANNESTAD_REALISM_SHA256_MISMATCH: ${label} ${actualSha256} != ${expectedSha256}`);
  }
  return { bytes, byte_size: bytes.byteLength, sha256: actualSha256, url };
}

async function fetchVerifiedJson({ fetchImpl, url, expectedSha256, label }) {
  const loaded = await fetchVerifiedBytes({ fetchImpl, url, expectedSha256, label });
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(loaded.bytes));
  } catch (error) {
    throw new Error(`NANNESTAD_REALISM_JSON_INVALID: ${label}: ${error?.message ?? error}`);
  }
  return { value, byte_size: loaded.byte_size, sha256: loaded.sha256, url: loaded.url };
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

function assertRoadRealism(value) {
  const contract = NANNESTAD_REALISM_CONTRACT.road_realism;
  if (!value || typeof value !== 'object') throw new Error('NANNESTAD_REALISM_ROADS_NOT_OBJECT');
  if (value.schema !== contract.schema) throw new Error('NANNESTAD_REALISM_ROADS_SCHEMA_MISMATCH');
  if (value.tile_id !== TILE_ID || value.horizontal_crs !== HORIZONTAL_CRS) throw new Error('NANNESTAD_REALISM_ROADS_WORLD_FRAME_MISMATCH');
  if (value.compiler_algorithm !== contract.compiler_algorithm) throw new Error('NANNESTAD_REALISM_ROADS_ALGORITHM_MISMATCH');
  if (!Array.isArray(value.width_features) || value.width_features.length < 1) throw new Error('NANNESTAD_REALISM_ROADS_WIDTH_FEATURES_INVALID');
  for (const feature of value.width_features) {
    if (!(Number.isFinite(feature?.width_m) && feature.width_m >= 0.8 && feature.width_m <= 30)) throw new Error('NANNESTAD_REALISM_ROADS_WIDTH_INVALID');
    if (!Array.isArray(feature?.points) || feature.points.length < 2) throw new Error('NANNESTAD_REALISM_ROADS_GEOMETRY_INVALID');
    if (![838, 583].includes(Number(feature?.source_type_id))) throw new Error('NANNESTAD_REALISM_ROADS_SOURCE_TYPE_INVALID');
  }
  if (!Array.isArray(value.source_snapshots) || value.source_snapshots.length !== 3) throw new Error('NANNESTAD_REALISM_ROADS_SOURCE_SNAPSHOTS_INVALID');
}

function assertStreetDetail(value) {
  const contract = NANNESTAD_REALISM_CONTRACT.street_detail;
  if (!value || typeof value !== 'object') throw new Error('NANNESTAD_REALISM_STREET_NOT_OBJECT');
  if (value.schema !== contract.schema) throw new Error('NANNESTAD_REALISM_STREET_SCHEMA_MISMATCH');
  if (value.tile_id !== TILE_ID || value.horizontal_crs !== HORIZONTAL_CRS) throw new Error('NANNESTAD_REALISM_STREET_WORLD_FRAME_MISMATCH');
  if (value.compiler_algorithm !== contract.compiler_algorithm) throw new Error('NANNESTAD_REALISM_STREET_ALGORITHM_MISMATCH');
  if (!Array.isArray(value.features) || value.features.length < 1) throw new Error('NANNESTAD_REALISM_STREET_FEATURES_INVALID');
  if (!(Number(value?.stats?.feature_part_count) === value.features.length)) throw new Error('NANNESTAD_REALISM_STREET_COUNT_MISMATCH');
  if (!(Number(value?.stats?.features_with_source_location) > 0)) throw new Error('NANNESTAD_REALISM_STREET_SOURCE_LOCATION_MISSING');
  if (!(Number(value?.stats?.feature_parts_by_type_id?.['96']) > 0)) throw new Error('NANNESTAD_REALISM_STREET_SIGN_PLATES_MISSING');
  for (const feature of value.features) {
    if (!Number.isInteger(feature?.source_type_id)) throw new Error('NANNESTAD_REALISM_STREET_TYPE_INVALID');
    if (feature?.geometry_type === 'point') {
      if (!Array.isArray(feature.point) || feature.point.length !== 2) throw new Error('NANNESTAD_REALISM_STREET_POINT_INVALID');
    } else if (feature?.geometry_type === 'line') {
      if (!Array.isArray(feature.points) || feature.points.length < 2) throw new Error('NANNESTAD_REALISM_STREET_LINE_INVALID');
    } else throw new Error('NANNESTAD_REALISM_STREET_GEOMETRY_TYPE_INVALID');
  }
}

function assertSignArtworkManifest(value) {
  const contract = NANNESTAD_REALISM_CONTRACT.sign_artwork;
  if (!value || typeof value !== 'object') throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_NOT_OBJECT');
  if (value.schema !== contract.schema || value.status !== 'PASS') throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_SCHEMA_INVALID');
  if (value.license_profile !== contract.license_profile) throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_LICENSE_MISMATCH');
  if (value.source_archive_sha256 !== contract.source_archive_sha256) throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_ARCHIVE_MISMATCH');
  if (JSON.stringify(value.requested_sign_codes) !== JSON.stringify(contract.admitted_sign_codes)) throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_CODE_SET_MISMATCH');
  if (!Array.isArray(value.assets) || value.assets.length !== contract.admitted_sign_codes.length) throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_ASSET_COUNT_INVALID');
  for (const asset of value.assets) {
    if (!contract.admitted_sign_codes.includes(asset?.sign_code)) throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_CODE_INVALID');
    if (typeof asset?.runtime_filename !== 'string' || !asset.runtime_filename) throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_FILENAME_INVALID');
    if (typeof asset?.sha256 !== 'string' || asset.sha256.length !== 64) throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_SHA_INVALID');
    if (!(Number.isInteger(asset?.byte_size) && asset.byte_size > 0)) throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_SIZE_INVALID');
  }
}

function bytesToDataUrl(bytes, mediaType) {
  if (typeof globalThis.btoa !== 'function') return null;
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return `data:${mediaType || 'application/octet-stream'};base64,${globalThis.btoa(binary)}`;
}

async function loadOptionalDerivedLayer({ fetchImpl, manifestUrl, descriptor, label, assertValue }) {
  if (!descriptor) return null;
  if (typeof descriptor.path !== 'string' || typeof descriptor.artifact_sha256 !== 'string') {
    throw new Error(`NANNESTAD_REALISM_${label.toUpperCase()}_DESCRIPTOR_INVALID`);
  }
  const loaded = await fetchVerifiedJson({
    fetchImpl,
    url: new URL(descriptor.path, manifestUrl).href,
    expectedSha256: descriptor.artifact_sha256,
    label,
  });
  assertValue(loaded.value);
  return loaded;
}

async function loadSignArtwork({ fetchImpl, manifestUrl, descriptor }) {
  if (!descriptor) return null;
  if (typeof descriptor.path !== 'string' || typeof descriptor.artifact_sha256 !== 'string') {
    throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_DESCRIPTOR_INVALID');
  }
  if (descriptor.source_archive_sha256 !== SVV_VIKEPLIKT_ARCHIVE_SHA256) throw new Error('NANNESTAD_REALISM_SIGN_ARTWORK_DESCRIPTOR_ARCHIVE_MISMATCH');
  const manifestAsset = await fetchVerifiedJson({
    fetchImpl,
    url: new URL(descriptor.path, manifestUrl).href,
    expectedSha256: descriptor.artifact_sha256,
    label: 'sign-artwork-manifest',
  });
  assertSignArtworkManifest(manifestAsset.value);
  const manifestAssetUrl = manifestAsset.url;
  const assets = {};
  for (const asset of manifestAsset.value.assets) {
    const loaded = await fetchVerifiedBytes({
      fetchImpl,
      url: new URL(asset.runtime_filename, manifestAssetUrl).href,
      expectedSha256: asset.sha256,
      expectedByteSize: asset.byte_size,
      label: `sign-artwork-${asset.sign_code}`,
    });
    assets[asset.sign_code] = Object.freeze({
      sign_code: asset.sign_code,
      sha256: loaded.sha256,
      byte_size: loaded.byte_size,
      media_type: asset.media_type,
      source_archive_entry: asset.source_archive_entry,
      url: loaded.url,
      data_url: bytesToDataUrl(loaded.bytes, asset.media_type),
    });
  }
  return Object.freeze({
    schema: 'nwe.web-sign-artwork-runtime/0.1',
    source_archive_sha256: manifestAsset.value.source_archive_sha256,
    license_profile: manifestAsset.value.license_profile,
    attribution: manifestAsset.value.attribution,
    assets_by_code: Object.freeze(assets),
    transport: Object.freeze({
      manifest_url: manifestAsset.url,
      manifest_sha256: manifestAsset.sha256,
      manifest_byte_size: manifestAsset.byte_size,
    }),
  });
}

const ADMITTED_TREE_SOURCE_SHA256 = '812f691eb68119681038aed7f45dd80bff0a152afe1fc8160ea5cbeeae9143da';

async function loadOptionalTreeAsset({ fetchImpl, manifestUrl, descriptor }) {
  if (!descriptor) return null;
  if (descriptor.schema !== 'nwe.tree-presentation-asset/0.1'
      || descriptor.license !== 'CC0-1.0'
      || descriptor.source_sha256 !== ADMITTED_TREE_SOURCE_SHA256
      || descriptor.truth_status !== 'presentation-only-generic-conifer-not-an-observed-tree'
      || descriptor.max_near_instances !== 36
      || descriptor.near_radius_m !== 125
      || !(descriptor.nominal_height_m >= 7.5 && descriptor.nominal_height_m <= 8.5)
      || !(descriptor.triangles >= 100 && descriptor.triangles <= 12000)
      || !Number.isInteger(descriptor.byte_size) || descriptor.byte_size > 700000) {
    throw new Error('NANNESTAD_TREE_PRESENTATION_DESCRIPTOR_INVALID');
  }
  // An untrusted descriptor must not turn the browser into an external model
  // downloader. Only the same compiled snapshot origin is acceptable.
  const allowedBase = new URL(manifestUrl);
  const glbUrl = new URL(descriptor.path, manifestUrl);
  const reportUrl = new URL(descriptor.report_path, manifestUrl);
  if (glbUrl.origin !== allowedBase.origin || reportUrl.origin !== allowedBase.origin
      || !glbUrl.pathname.endsWith('/realism/trees/conifer-light-merged.glb')
      || !reportUrl.pathname.endsWith('/realism/trees/conifer-light-report.json')) {
    throw new Error('NANNESTAD_TREE_PRESENTATION_URL_OUTSIDE_RUNTIME');
  }
  const [glb, report] = await Promise.all([
    fetchVerifiedBytes({ fetchImpl, url: glbUrl.href,
      expectedSha256: descriptor.sha256, expectedByteSize: descriptor.byte_size, label: 'tree-asset-glb' }),
    fetchVerifiedJson({ fetchImpl, url: reportUrl.href,
      expectedSha256: descriptor.report_sha256, label: 'tree-asset-source-report' }),
  ]);
  const source = report.value?.source, runtime = report.value?.runtime;
  if (report.value?.schema !== descriptor.schema || report.value?.status !== 'PASS'
      || report.value?.tile_id !== TILE_ID
      || source?.sha256 !== ADMITTED_TREE_SOURCE_SHA256 || source?.license !== 'CC0-1.0'
      || runtime?.sha256 !== glb.sha256 || runtime?.byte_size !== glb.byte_size
      || runtime?.triangles !== descriptor.triangles || runtime?.mesh_count !== 1
      || runtime?.max_near_instances !== descriptor.max_near_instances
      || runtime?.near_radius_m !== descriptor.near_radius_m
      || report.value?.runtime_provider_requests !== 0) {
    throw new Error('NANNESTAD_TREE_PRESENTATION_PROVENANCE_MISMATCH');
  }
  const header = new DataView(glb.bytes.buffer, glb.bytes.byteOffset, glb.bytes.byteLength);
  if (glb.bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67
      || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== glb.byte_size) {
    throw new Error('NANNESTAD_TREE_PRESENTATION_GLB_HEADER_INVALID');
  }
  return Object.freeze({
    schema: descriptor.schema, bytes: glb.bytes,
    sha256: glb.sha256, source_sha256: source.sha256,
    nominal_height_m: runtime.nominal_height_m,
    max_near_instances: runtime.max_near_instances,
    near_radius_m: runtime.near_radius_m, triangle_count: runtime.triangles,
    presentation_only: true,
  });
}

export async function loadNannestadRealismRuntime({ fetchImpl = globalThis.fetch, manifestUrl = null } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('NANNESTAD_REALISM_FETCH_REQUIRED');
  const resolvedManifestUrl = resolvePreviewManifestUrl(manifestUrl);
  const manifest = await fetchManifest({ fetchImpl, manifestUrl: resolvedManifestUrl });
  const layers = manifest.realism_layers ?? {};
  const surfaceDescriptor = layers.building_surface;
  const roofDescriptor = layers.roof_orientation;
  const vegetationDescriptor = layers.vegetation;
  const roadDescriptor = layers.road_realism;
  const streetDescriptor = layers.street_detail;
  const signArtworkDescriptor = layers.sign_artwork;
  const treeAssetDescriptor = layers.tree_asset;

  const [surface, roof, vegetation, roads, street, signArtwork, treeAsset] = await Promise.all([
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
    loadOptionalDerivedLayer({ fetchImpl, manifestUrl: resolvedManifestUrl, descriptor: roadDescriptor, label: 'road-realism', assertValue: assertRoadRealism }),
    loadOptionalDerivedLayer({ fetchImpl, manifestUrl: resolvedManifestUrl, descriptor: streetDescriptor, label: 'street-detail', assertValue: assertStreetDetail }),
    loadSignArtwork({ fetchImpl, manifestUrl: resolvedManifestUrl, descriptor: signArtworkDescriptor }),
    loadOptionalTreeAsset({ fetchImpl, manifestUrl: resolvedManifestUrl, descriptor: treeAssetDescriptor }),
  ]);

  assertBuildingSurface(surface.value);
  assertRoofOrientation(roof.value);
  assertVegetation(vegetation.value);

  return Object.freeze({
    schema: 'nwe.web-nannestad-realism-runtime/0.4',
    tile_id: TILE_ID,
    building_surface: surface.value,
    roof_orientation: roof.value,
    vegetation: vegetation.value,
    road_realism: roads?.value ?? null,
    street_detail: street?.value ?? null,
    sign_artwork: signArtwork,
    tree_asset: treeAsset,
    transport: Object.freeze({
      manifest_url: resolvedManifestUrl,
      manifest_staged_layers: Boolean(surfaceDescriptor && roofDescriptor && vegetationDescriptor),
      building_surface: Object.freeze({ sha256: surface.sha256, byte_size: surface.byte_size, url: surface.url }),
      roof_orientation: Object.freeze({ sha256: roof.sha256, byte_size: roof.byte_size, url: roof.url }),
      vegetation: Object.freeze({ sha256: vegetation.sha256, byte_size: vegetation.byte_size, url: vegetation.url }),
      road_realism: roads ? Object.freeze({ sha256: roads.sha256, byte_size: roads.byte_size, url: roads.url }) : null,
      street_detail: street ? Object.freeze({ sha256: street.sha256, byte_size: street.byte_size, url: street.url }) : null,
      sign_artwork: signArtwork?.transport ?? null,
      tree_asset: treeAsset ? Object.freeze({ sha256: treeAsset.sha256, source_sha256: treeAsset.source_sha256 }) : null,
    }),
  });
}
