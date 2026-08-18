import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { canonicalSha256, canonicalText } from '../schemas/js/src/canonical.mjs';
import { buildTerrainMeshBuffers } from './terrain_mesh_buffers.mjs';
import {
  createTerrainTileLoadFunction,
  decodeTerrainHeightGridArtifact,
  TerrainTileLoadError,
} from './terrain_tile_loader.mjs';
import { artifactIdentityPayload, verifyRuntimeBundle } from './runtime_verifier.mjs';
import { TileStreamingScheduler } from './tile_scheduler.mjs';

const TERRAIN_MEDIA_TYPE = 'application/vnd.nwe.terrain-height-grid';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gates() {
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

function syntheticGrid(width = 4, height = 4) {
  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      values[row * width + column] = 180 + column * 0.75 + row * 0.25;
    }
  }
  return values;
}

function buildHeightGridArtifact({
  tileId = 'epsg25832_0_0_4m',
  values = syntheticGrid(),
  width = 4,
  height = 4,
  bounds = [0, 0, 4, 4],
} = {}) {
  const header = {
    schema: 'nwe.terrain-height-grid-artifact/0.1',
    tile_id: tileId,
    horizontal_crs: 'EPSG:25832',
    vertical_datum: 'NN2000',
    bounds,
    width,
    height,
    pixel_size_m: 1,
    nodata: -32767,
    storage: 'float32-le-row-major-north-to-south',
    elevation_min_m: Math.min(...values),
    elevation_max_m: Math.max(...values),
  };
  const headerBytes = new TextEncoder().encode(canonicalText(header));
  const artifact = new Uint8Array(12 + headerBytes.byteLength + values.length * 4);
  artifact.set(new TextEncoder().encode('NWEHGT01'), 0);
  new DataView(artifact.buffer).setUint32(8, headerBytes.byteLength, true);
  artifact.set(headerBytes, 12);
  const dataOffset = 12 + headerBytes.byteLength;
  const view = new DataView(artifact.buffer);
  for (let index = 0; index < values.length; index += 1) view.setFloat32(dataOffset + index * 4, values[index], true);
  return { artifactBytes: artifact, header };
}

function buildBundle(artifactBytes, tileId) {
  const source = {
    schema: 'nwe.source-snapshot/0.3',
    source_id: 'fixture:dtm1',
    raw_sha256: 'a'.repeat(64),
    raw_byte_size: 123,
    source_crs: 'EPSG:25833',
    source_vertical_datum: 'NN2000',
    z_semantics: 'normal_height_m',
  };
  const sourceHash = canonicalSha256(source);
  const transform = {
    schema: 'nwe.transform-contract/0.1',
    source_snapshot_hash: sourceHash,
    operation: 'dtm1-epsg25833-reproject-bilinear-fixed-grid-epsg25832',
    source_crs: 'EPSG:25833',
    horizontal_crs: 'EPSG:25832',
    vertical_datum: 'NN2000',
    vertical_operation: 'identity-NN2000',
    resampling: 'bilinear',
    bounds_epsg25832: ['0', '0', '4', '4'],
    pixel_size_m: '1',
    width: 4,
    height: 4,
    num_threads: 1,
  };
  const transformHash = canonicalSha256(transform);
  const normalized = {
    schema: 'nwe.normalized-snapshot/0.1',
    source_snapshot_hash: sourceHash,
    transform_contract_hash: transformHash,
    sha256: 'b'.repeat(64),
    byte_size: 456,
    media_type: 'image/tiff; profile=nwe.normalized-dtm/0.2',
    sample_count: 16,
    horizontal_crs: 'EPSG:25832',
    vertical_datum: 'NN2000',
  };
  const normalizedHash = canonicalSha256(normalized);
  const compilerConfig = {
    schema: 'nwe.compiler-config/0.1',
    compiler_id: 'nwe-world-compiler',
    compiler_version: '0.1.0',
    terrain_format: 'nwe-height-grid/0.1',
    storage: 'float32-le-row-major-north-to-south',
    quantization: 'none',
  };
  const compilerConfigHash = canonicalSha256(compilerConfig);
  const lineage = {
    schema: 'nwe.compile-lineage/0.1',
    tile_id: tileId,
    artifact_role: 'terrain-height-grid',
    source_snapshot_hashes: [sourceHash],
    normalized_snapshot_hashes: [normalizedHash],
    compiler_config_hash: compilerConfigHash,
  };
  const lineageHash = canonicalSha256(lineage);
  const artifactRef = {
    schema: 'nwe.artifact-ref/0.1',
    artifact_role: 'terrain-height-grid',
    tile_id: tileId,
    sha256: sha256(artifactBytes),
    byte_size: artifactBytes.byteLength,
    media_type: TERRAIN_MEDIA_TYPE,
    lineage_hash: lineageHash,
    artifact_status: 'REAL_COMPILED',
    transport: { reference: `cache://compiled/${tileId}/terrain-height-grid/${sha256(artifactBytes)}.nwehgt` },
  };
  const artifactRefHash = canonicalSha256(artifactIdentityPayload(artifactRef));
  const promotion = {
    schema: 'nwe.promotion-record/0.1',
    lineage_hash: lineageHash,
    artifact_ref_hash: artifactRefHash,
    from_state: 'NORMALIZED',
    to_state: 'REAL_COMPILED',
    gates: gates(),
  };
  return {
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
    promotion_record_hash: canonicalSha256(promotion),
  };
}

class FakeMeshWorkerClient {
  constructor() {
    this.dispatches = 0;
  }

  async build({ elevationBuffer, options, signal }) {
    if (signal?.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    this.dispatches += 1;
    const elevations = new Float32Array(elevationBuffer);
    const mesh = buildTerrainMeshBuffers({ elevations, ...options });
    return {
      jobId: this.dispatches,
      durationMs: 0.25,
      metadata: mesh.metadata,
      elevations,
      positions: mesh.positions,
      normals: mesh.normals,
      uvs: mesh.uvs,
      indices: mesh.indices,
    };
  }
}

function meshOptionsForTile() {
  return { outputSize: 3, originE: 2, originN: 2, originH: 180 };
}

function fixture(tileId = 'epsg25832_0_0_4m') {
  const { artifactBytes, header } = buildHeightGridArtifact({ tileId });
  return { artifactBytes, header, bundle: buildBundle(artifactBytes, tileId) };
}

function makeLoader(input, worker, overrides = {}) {
  return createTerrainTileLoadFunction({
    resolveRuntimeInput: async () => input,
    verifyBundle: verifyRuntimeBundle,
    meshWorkerClient: worker,
    meshOptionsForTile,
    ...overrides,
  });
}

async function testDecoderReadsCanonicalArtifact() {
  const { artifactBytes, header } = fixture();
  const decoded = decodeTerrainHeightGridArtifact(artifactBytes);
  assert.deepEqual(decoded.header, header);
  assert.equal(decoded.sampleCount, 16);
  assert.deepEqual([...decoded.elevations], [...syntheticGrid()]);
}

async function testDecoderFailsClosedOnTrailingOrTruncatedBytes() {
  const { artifactBytes } = fixture();
  assert.throws(
    () => decodeTerrainHeightGridArtifact(artifactBytes.subarray(0, artifactBytes.byteLength - 1)),
    (error) => error instanceof TerrainTileLoadError && error.code === 'ARTIFACT_DATA_SIZE_MISMATCH',
  );
  const trailing = new Uint8Array(artifactBytes.byteLength + 1);
  trailing.set(artifactBytes);
  assert.throws(
    () => decodeTerrainHeightGridArtifact(trailing),
    (error) => error instanceof TerrainTileLoadError && error.code === 'ARTIFACT_DATA_SIZE_MISMATCH',
  );
}

async function testFullVerifierPrecedesWorkerDispatch() {
  const good = fixture();
  const tampered = good.artifactBytes.slice();
  tampered[tampered.byteLength - 1] ^= 0xff;
  const worker = new FakeMeshWorkerClient();
  const loader = makeLoader({ bundle: good.bundle, artifactBytes: tampered }, worker);
  await assert.rejects(
    loader({ id: good.header.tile_id }, {}),
    (error) => error instanceof TerrainTileLoadError && error.code === 'RUNTIME_VERIFICATION_REJECTED',
  );
  assert.equal(worker.dispatches, 0, 'unverified bytes must never reach the mesh worker');
}

async function testSemanticDecodePrecedesWorkerDispatch() {
  const malformed = new TextEncoder().encode('not-an-nwehgt-artifact');
  const tileId = 'epsg25832_0_0_4m';
  const input = { artifactBytes: malformed, bundle: buildBundle(malformed, tileId) };
  assert.equal(verifyRuntimeBundle(input.bundle, malformed).ok, true, 'fixture bundle should bind malformed bytes exactly');
  const worker = new FakeMeshWorkerClient();
  const loader = makeLoader(input, worker);
  await assert.rejects(
    loader({ id: tileId }, {}),
    (error) => error instanceof TerrainTileLoadError && error.code === 'ARTIFACT_MAGIC_MISMATCH',
  );
  assert.equal(worker.dispatches, 0, 'semantically invalid terrain must never reach the worker');
}

async function testTileIdentityMismatchFailsAfterVerificationBeforeWorker() {
  const input = fixture('epsg25832_artifact_tile');
  const worker = new FakeMeshWorkerClient();
  const loader = makeLoader(input, worker);
  await assert.rejects(
    loader({ id: 'epsg25832_requested_tile' }, {}),
    (error) => error instanceof TerrainTileLoadError && error.code === 'TILE_BUNDLE_ID_MISMATCH',
  );
  assert.equal(worker.dispatches, 0);
}

async function testAbortBeforeResolutionDoesNoWork() {
  const input = fixture();
  const worker = new FakeMeshWorkerClient();
  let resolutions = 0;
  const loader = makeLoader(input, worker, {
    resolveRuntimeInput: async () => {
      resolutions += 1;
      return input;
    },
  });
  const controller = new AbortController();
  controller.abort('camera moved');
  await assert.rejects(loader({ id: input.header.tile_id }, { signal: controller.signal }), (error) => error.name === 'AbortError');
  assert.equal(resolutions, 0);
  assert.equal(worker.dispatches, 0);
}

async function testSchedulerLoadsVerifiedTerrainWorkerPayload() {
  const input = fixture();
  const worker = new FakeMeshWorkerClient();
  const loader = makeLoader(input, worker);
  let activated = null;
  const scheduler = new TileStreamingScheduler({
    loadTile: loader,
    activateTile: async (_tile, payload) => { activated = payload; },
    activeRadiusMeters: 10,
    retainRadiusMeters: 20,
    maxConcurrentLoads: 1,
    maxResidentTiles: 1,
    maxCacheBytes: 1024 * 1024,
  });
  const tile = { id: input.header.tile_id, centerE: 2, centerN: 2 };
  await scheduler.update({ e: 2, n: 2 }, [tile]);
  const snapshot = await scheduler.whenIdle();

  assert.equal(snapshot.metrics.loadsStarted, 1);
  assert.equal(snapshot.metrics.loadsCompleted, 1);
  assert.equal(snapshot.metrics.loadsFailed, 0);
  assert.equal(snapshot.metrics.residentCount, 1);
  assert.equal(snapshot.records[0].byteSize, 400);
  assert.equal(worker.dispatches, 1);
  assert.equal(activated.schema, 'nwe.terrain-tile-runtime-payload/0.1');
  assert.equal(activated.verification.code, 'RUNTIME_VERIFICATION_PASS');
  assert.equal(activated.elevations.byteLength, 64);
  assert.equal(activated.mesh.metadata.byteSize, 336);
  assert.equal(activated.artifact.sha256, input.bundle.artifact_ref.sha256);
}

async function main() {
  await testDecoderReadsCanonicalArtifact();
  await testDecoderFailsClosedOnTrailingOrTruncatedBytes();
  await testFullVerifierPrecedesWorkerDispatch();
  await testSemanticDecodePrecedesWorkerDispatch();
  await testTileIdentityMismatchFailsAfterVerificationBeforeWorker();
  await testAbortBeforeResolutionDoesNoWork();
  await testSchedulerLoadsVerifiedTerrainWorkerPayload();
  console.log('terrain runtime pipeline regressions: PASS (7 cases)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
