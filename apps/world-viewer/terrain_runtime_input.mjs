import { assertCompiledTransport, defaultCacheResolver } from './artifact_consumer.mjs';

const TERRAIN_ROLE = 'terrain-height-grid';
const TERRAIN_MEDIA_TYPE = 'application/vnd.nwe.terrain-height-grid';

export class TerrainRuntimeInputError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'TerrainRuntimeInputError';
    this.code = code;
  }
}

function absoluteBundleUrl(bundleUrl) {
  try {
    return new URL(bundleUrl, globalThis.location?.href).href;
  } catch (error) {
    throw new TerrainRuntimeInputError(
      'BUNDLE_URL_INVALID',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function loadTerrainRuntimeInput({
  bundleUrl,
  expectedTileId = null,
  fetchImpl = globalThis.fetch,
  resolveTransport = defaultCacheResolver,
  signal = undefined,
} = {}) {
  if (typeof bundleUrl !== 'string' || !bundleUrl) {
    throw new TerrainRuntimeInputError('BUNDLE_URL_REQUIRED', 'bundleUrl must be a non-empty string');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TerrainRuntimeInputError('FETCH_REQUIRED', 'fetch implementation is unavailable');
  }
  if (typeof resolveTransport !== 'function') {
    throw new TerrainRuntimeInputError('TRANSPORT_RESOLVER_REQUIRED', 'resolveTransport must be a function');
  }

  const resolvedBundleUrl = absoluteBundleUrl(bundleUrl);
  const bundleResponse = await fetchImpl(resolvedBundleUrl, { cache: 'no-store', signal });
  if (!bundleResponse.ok) {
    throw new TerrainRuntimeInputError('BUNDLE_FETCH_FAILED', `${bundleResponse.status} ${resolvedBundleUrl}`);
  }
  const bundle = await bundleResponse.json();
  const artifactRef = bundle?.artifact_ref;
  if (!artifactRef || artifactRef.schema !== 'nwe.artifact-ref/0.1') {
    throw new TerrainRuntimeInputError('ARTIFACT_REF_INVALID', String(artifactRef?.schema ?? 'missing'));
  }
  if (artifactRef.artifact_status !== 'REAL_COMPILED') {
    throw new TerrainRuntimeInputError('ARTIFACT_NOT_REAL_COMPILED', String(artifactRef.artifact_status));
  }
  if (artifactRef.artifact_role !== TERRAIN_ROLE) {
    throw new TerrainRuntimeInputError('ARTIFACT_ROLE_MISMATCH', `${artifactRef.artifact_role} != ${TERRAIN_ROLE}`);
  }
  if (artifactRef.media_type !== TERRAIN_MEDIA_TYPE) {
    throw new TerrainRuntimeInputError('ARTIFACT_MEDIA_TYPE_MISMATCH', `${artifactRef.media_type} != ${TERRAIN_MEDIA_TYPE}`);
  }
  if (expectedTileId && artifactRef.tile_id !== expectedTileId) {
    throw new TerrainRuntimeInputError('TILE_ID_MISMATCH', `${artifactRef.tile_id} != ${expectedTileId}`);
  }

  // Fail before the compiled-artifact request if a bundle tries to point the
  // browser at a raw Norwegian source service.
  const reference = assertCompiledTransport(artifactRef.transport?.reference ?? artifactRef.reference);
  const artifactUrl = resolveTransport(reference, resolvedBundleUrl);
  assertCompiledTransport(artifactUrl);

  const artifactResponse = await fetchImpl(artifactUrl, { cache: 'force-cache', signal });
  if (!artifactResponse.ok) {
    throw new TerrainRuntimeInputError('ARTIFACT_FETCH_FAILED', `${artifactResponse.status} ${artifactUrl}`);
  }
  const artifactBytes = new Uint8Array(await artifactResponse.arrayBuffer());
  return { bundle, artifactRef, artifactBytes, artifactUrl, bundleUrl: resolvedBundleUrl };
}
