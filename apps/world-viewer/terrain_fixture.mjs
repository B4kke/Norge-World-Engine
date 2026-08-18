import canonicalize from 'canonicalize';

import { artifactIdentityPayload } from '../../engine/streaming/runtime_verifier_core.mjs';

const encoder = new TextEncoder();

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function canonicalBytes(value) {
  const text = canonicalize(value);
  if (text === undefined) throw new TypeError('value cannot be canonicalized');
  return encoder.encode(text);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes, cryptoImpl) {
  if (!cryptoImpl?.subtle) throw new Error('WEBCRYPTO_REQUIRED: crypto.subtle is unavailable');
  return toHex(await cryptoImpl.subtle.digest('SHA-256', bytes));
}

async function canonicalSha256(value, cryptoImpl) {
  return sha256(canonicalBytes(value), cryptoImpl);
}

function promotionGates() {
  return {
    source_validated: 'PASS',
    transform_validated: 'PASS',
    normalized_bytes_verified: 'PASS',
    compiler_identity_bound: 'PASS',
    artifact_bytes_verified: 'PASS',
    lineage_reconstructed: 'PASS',
    determinism_policy_satisfied: 'PASS',
  };
}

export async function buildSyntheticTerrainRuntimeFixture({
  tileId = 'epsg25832_611000_6677000_1000m',
  width = 1000,
  height = 1000,
  bounds = [611000, 6677000, 612000, 6678000],
  cryptoImpl = globalThis.crypto,
} = {}) {
  const startedAt = now();
  if (!Number.isInteger(width) || width <= 1 || !Number.isInteger(height) || height <= 1) {
    throw new TypeError('width/height must be integers > 1');
  }
  if (!Array.isArray(bounds) || bounds.length !== 4) throw new TypeError('bounds must contain 4 numbers');

  const sampleCount = width * height;
  const elevations = new Float32Array(sampleCount);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const ridge = Math.sin(column / 41) * 1.5 + Math.cos(row / 57) * 1.2;
      const hill = Math.exp(-(((column - 610) ** 2) + ((row - 390) ** 2)) / 80000) * 22;
      const value = 178 + row * 0.006 + column * 0.004 + ridge + hill;
      const stored = Math.fround(value);
      elevations[row * width + column] = stored;
      minimum = Math.min(minimum, stored);
      maximum = Math.max(maximum, stored);
    }
  }

  const pixelSize = (bounds[2] - bounds[0]) / width;
  const header = {
    schema: 'nwe.terrain-height-grid-artifact/0.1',
    tile_id: tileId,
    horizontal_crs: 'EPSG:25832',
    vertical_datum: 'NN2000',
    bounds,
    width,
    height,
    pixel_size_m: pixelSize,
    nodata: -32767,
    storage: 'float32-le-row-major-north-to-south',
    elevation_min_m: minimum,
    elevation_max_m: maximum,
  };
  const headerBytes = canonicalBytes(header);
  const artifactBytes = new Uint8Array(12 + headerBytes.byteLength + sampleCount * 4);
  artifactBytes.set(encoder.encode('NWEHGT01'), 0);
  const view = new DataView(artifactBytes.buffer);
  view.setUint32(8, headerBytes.byteLength, true);
  artifactBytes.set(headerBytes, 12);
  const dataOffset = 12 + headerBytes.byteLength;
  for (let index = 0; index < elevations.length; index += 1) {
    view.setFloat32(dataOffset + index * 4, elevations[index], true);
  }

  const source = {
    schema: 'nwe.source-snapshot/0.3',
    source_id: 'fixture:world-viewer-terrain-experiment',
    raw_sha256: 'a'.repeat(64),
    raw_byte_size: artifactBytes.byteLength,
    source_crs: 'EPSG:25832',
    source_vertical_datum: 'NN2000',
    z_semantics: 'normal_height_m',
  };
  const sourceHash = await canonicalSha256(source, cryptoImpl);
  const transform = {
    schema: 'nwe.transform-contract/0.1',
    source_snapshot_hash: sourceHash,
    operation: 'synthetic-structural-fixture-no-resampling',
    source_crs: 'EPSG:25832',
    horizontal_crs: 'EPSG:25832',
    vertical_datum: 'NN2000',
    vertical_operation: 'identity-NN2000',
    resampling: 'none',
    bounds_epsg25832: bounds.map((value) => String(value)),
    pixel_size_m: String(pixelSize),
    width,
    height,
    num_threads: 1,
  };
  const transformHash = await canonicalSha256(transform, cryptoImpl);
  const normalized = {
    schema: 'nwe.normalized-snapshot/0.1',
    source_snapshot_hash: sourceHash,
    transform_contract_hash: transformHash,
    sha256: 'b'.repeat(64),
    byte_size: sampleCount * 4,
    media_type: 'application/vnd.nwe.fixture-height-grid',
    sample_count: sampleCount,
    horizontal_crs: 'EPSG:25832',
    vertical_datum: 'NN2000',
  };
  const normalizedHash = await canonicalSha256(normalized, cryptoImpl);
  const compilerConfig = {
    schema: 'nwe.compiler-config/0.1',
    compiler_id: 'nwe-world-viewer-terrain-fixture',
    compiler_version: '0.1.0',
    terrain_format: 'nwe-height-grid/0.1',
    storage: 'float32-le-row-major-north-to-south',
    quantization: 'none',
  };
  const compilerConfigHash = await canonicalSha256(compilerConfig, cryptoImpl);
  const lineage = {
    schema: 'nwe.compile-lineage/0.1',
    tile_id: tileId,
    artifact_role: 'terrain-height-grid',
    source_snapshot_hashes: [sourceHash],
    normalized_snapshot_hashes: [normalizedHash],
    compiler_config_hash: compilerConfigHash,
  };
  const lineageHash = await canonicalSha256(lineage, cryptoImpl);
  const artifactRef = {
    schema: 'nwe.artifact-ref/0.1',
    artifact_role: 'terrain-height-grid',
    tile_id: tileId,
    sha256: await sha256(artifactBytes, cryptoImpl),
    byte_size: artifactBytes.byteLength,
    media_type: 'application/vnd.nwe.terrain-height-grid',
    lineage_hash: lineageHash,
    artifact_status: 'REAL_COMPILED',
    transport: { reference: 'fixture://compiled/terrain.nwehgt' },
  };
  const artifactRefHash = await canonicalSha256(artifactIdentityPayload(artifactRef), cryptoImpl);
  const promotion = {
    schema: 'nwe.promotion-record/0.1',
    lineage_hash: lineageHash,
    artifact_ref_hash: artifactRefHash,
    from_state: 'NORMALIZED',
    to_state: 'REAL_COMPILED',
    gates: promotionGates(),
  };
  const bundle = {
    bundle_schema: 'nwe.runtime-verification-bundle/0.1',
    canonicalization_id: 'urn:ietf:rfc:8785',
    hash_algorithm: 'sha-256',
    source_snapshots: [source],
    source_snapshot_hashes: [sourceHash],
    transform_contracts: [transform],
    transform_contract_hashes: [transformHash],
    normalized_snapshots: [normalized],
    normalized_snapshot_hashes: [normalizedHash],
    compiler_config: compilerConfig,
    compiler_config_hash: compilerConfigHash,
    compile_lineage: lineage,
    lineage_hash: lineageHash,
    artifact_ref: artifactRef,
    artifact_ref_hash: artifactRefHash,
    promotion_record: promotion,
    promotion_record_hash: await canonicalSha256(promotion, cryptoImpl),
  };

  return {
    bundle,
    artifactBytes,
    header,
    prepTimingMs: Math.max(0, now() - startedAt),
  };
}
