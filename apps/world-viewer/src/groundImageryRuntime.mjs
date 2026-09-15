export const GROUND_IMAGERY_SCHEMA = 'nwe.private-ground-imagery/0.1';

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`GROUND_IMAGERY_${label}_SHA256_INVALID`);
  }
}

function exactBounds(actual, expected) {
  return Array.isArray(actual)
    && Array.isArray(expected)
    && actual.length === 4
    && expected.length === 4
    && actual.every((value, index) => Number.isFinite(value) && Math.abs(Number(value) - Number(expected[index])) <= 1e-6);
}

function safeRelativeTexturePath(path) {
  return typeof path === 'string'
    && path.endsWith('.png')
    && !path.startsWith('/')
    && !path.includes('://')
    && !path.split('/').includes('..');
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function validateGroundImageryManifest(manifest, {
  expectedTileId,
  expectedBounds,
  publicRuntime = true,
} = {}) {
  if (manifest?.schema !== GROUND_IMAGERY_SCHEMA) {
    throw new Error(`GROUND_IMAGERY_SCHEMA_INVALID: ${manifest?.schema ?? 'missing'}`);
  }
  if (manifest.tile_id !== expectedTileId) {
    throw new Error(`GROUND_IMAGERY_TILE_MISMATCH: ${manifest.tile_id ?? 'missing'} != ${expectedTileId}`);
  }
  if (manifest.horizontal_crs !== 'EPSG:25832' || !exactBounds(manifest.bounds, expectedBounds)) {
    throw new Error('GROUND_IMAGERY_SPATIAL_CONTRACT_INVALID');
  }
  const texture = manifest.texture;
  if (!texture || !safeRelativeTexturePath(texture.path)
    || texture.format !== 'png-rgb8'
    || texture.uv_semantics !== 'u-west-to-east-v-north-to-south'
    || !Number.isInteger(texture.width) || texture.width < 256
    || !Number.isInteger(texture.height) || texture.height < 256
    || !Number.isInteger(texture.byte_size) || texture.byte_size <= 0) {
    throw new Error('GROUND_IMAGERY_TEXTURE_CONTRACT_INVALID');
  }
  assertSha256(texture.sha256, 'TEXTURE');
  const source = manifest.source;
  if (!source || typeof source.name !== 'string' || !source.name
    || typeof source.rights_basis !== 'string' || !source.rights_basis
    || !['private-only', 'allowed-by-license'].includes(source.redistribution)
    || source.raw_source_committed !== false) {
    throw new Error('GROUND_IMAGERY_SOURCE_CONTRACT_INVALID');
  }
  if (publicRuntime && source.redistribution !== 'allowed-by-license') {
    throw new Error('GROUND_IMAGERY_PUBLIC_REDISTRIBUTION_FORBIDDEN');
  }
  if (manifest.transform?.geometry_displacement !== false) {
    throw new Error('GROUND_IMAGERY_GEOMETRY_DISPLACEMENT_FORBIDDEN');
  }
  const gsd = Number(source.native_ground_sample_distance_m);
  if (source.provider === 'Copernicus Sentinel-2 via Earth Search'
    && (!(gsd > 0) || source.stac_item_id == null || source.copernicus_notice == null)) {
    throw new Error('GROUND_IMAGERY_SENTINEL_PROVENANCE_INCOMPLETE');
  }
  return manifest;
}

export async function loadGroundImageryRuntime({
  manifestUrl,
  expectedTileId,
  expectedBounds,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  createObjectUrl = (blob) => URL.createObjectURL(blob),
  revokeObjectUrl = (url) => URL.revokeObjectURL(url),
  publicRuntime = true,
} = {}) {
  if (typeof manifestUrl !== 'string' || !manifestUrl) throw new TypeError('manifestUrl is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  if (!cryptoImpl?.subtle) throw new Error('GROUND_IMAGERY_WEBCRYPTO_REQUIRED');

  const baseHref = globalThis.location?.href ?? manifestUrl;
  const resolvedManifest = new URL(manifestUrl, baseHref);
  const manifestResponse = await fetchImpl(resolvedManifest.href, { cache: 'no-store' });
  if (!manifestResponse.ok) {
    throw new Error(`GROUND_IMAGERY_MANIFEST_FETCH_FAILED: HTTP ${manifestResponse.status}`);
  }
  if (manifestResponse.url && new URL(manifestResponse.url).origin !== resolvedManifest.origin) {
    throw new Error('GROUND_IMAGERY_MANIFEST_REDIRECT_FORBIDDEN');
  }
  const manifest = validateGroundImageryManifest(await manifestResponse.json(), {
    expectedTileId,
    expectedBounds,
    publicRuntime,
  });
  const textureUrl = new URL(manifest.texture.path, resolvedManifest);
  if (textureUrl.origin !== resolvedManifest.origin) {
    throw new Error('GROUND_IMAGERY_TEXTURE_CROSS_ORIGIN_FORBIDDEN');
  }
  const textureResponse = await fetchImpl(textureUrl.href, { cache: 'force-cache' });
  if (!textureResponse.ok) {
    throw new Error(`GROUND_IMAGERY_TEXTURE_FETCH_FAILED: HTTP ${textureResponse.status}`);
  }
  if (textureResponse.url && new URL(textureResponse.url).origin !== textureUrl.origin) {
    throw new Error('GROUND_IMAGERY_TEXTURE_REDIRECT_FORBIDDEN');
  }
  const bytes = await textureResponse.arrayBuffer();
  if (bytes.byteLength !== manifest.texture.byte_size) {
    throw new Error(`GROUND_IMAGERY_TEXTURE_SIZE_MISMATCH: ${bytes.byteLength} != ${manifest.texture.byte_size}`);
  }
  const digest = bytesToHex(await cryptoImpl.subtle.digest('SHA-256', bytes));
  if (digest !== manifest.texture.sha256) {
    throw new Error(`GROUND_IMAGERY_TEXTURE_SHA256_MISMATCH: ${digest} != ${manifest.texture.sha256}`);
  }
  const objectUrl = createObjectUrl(new Blob([bytes], { type: 'image/png' }));
  let released = false;
  return {
    schema: GROUND_IMAGERY_SCHEMA,
    manifest,
    manifestUrl: resolvedManifest.href,
    sourceTextureUrl: textureUrl.href,
    textureUrl: objectUrl,
    textureSha256: digest,
    textureByteSize: bytes.byteLength,
    nativeGroundSampleDistanceM: Number(manifest.source.native_ground_sample_distance_m) || null,
    truth: manifest.transform?.sentinel_ground_truth ?? 'source-derived-ground-color-presentation-only',
    release() {
      if (released) return;
      released = true;
      revokeObjectUrl(objectUrl);
    },
  };
}
