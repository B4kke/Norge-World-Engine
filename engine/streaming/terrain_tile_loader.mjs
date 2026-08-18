const MAGIC_TEXT = 'NWEHGT01';
const MAGIC_BYTES = new TextEncoder().encode(MAGIC_TEXT);
const FIXED_PREFIX_BYTES = 12;
const TERRAIN_SCHEMA = 'nwe.terrain-height-grid-artifact/0.1';
const TERRAIN_MEDIA_TYPE = 'application/vnd.nwe.terrain-height-grid';
const TERRAIN_ROLE = 'terrain-height-grid';
const TERRAIN_STORAGE = 'float32-le-row-major-north-to-south';
const PAYLOAD_SCHEMA = 'nwe.terrain-tile-runtime-payload/0.1';

function abortError(reason) {
  const error = new Error(typeof reason === 'string' ? reason : 'terrain tile load aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', `${label} must be finite`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', `${label} must be a positive integer`);
  }
  return value;
}

function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function durationMs(start, end) {
  return Math.max(0, end - start);
}

function hostIsLittleEndian() {
  const probe = new ArrayBuffer(2);
  new DataView(probe).setUint16(0, 0x00ff, true);
  return new Uint8Array(probe)[0] === 0xff;
}

const HOST_LITTLE_ENDIAN = hostIsLittleEndian();

export class TerrainTileLoadError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'TerrainTileLoadError';
    this.code = code;
  }
}

function validateHeader(header) {
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', 'header must be an object');
  }
  if (header.schema !== TERRAIN_SCHEMA) {
    throw new TerrainTileLoadError('ARTIFACT_SCHEMA_UNSUPPORTED', String(header.schema ?? 'missing'));
  }
  if (typeof header.tile_id !== 'string' || !header.tile_id) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', 'tile_id must be a non-empty string');
  }
  if (typeof header.horizontal_crs !== 'string' || !header.horizontal_crs) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', 'horizontal_crs must be explicit');
  }
  if (header.vertical_datum !== 'NN2000') {
    throw new TerrainTileLoadError('ARTIFACT_VERTICAL_DATUM_UNSUPPORTED', String(header.vertical_datum ?? 'missing'));
  }
  if (header.storage !== TERRAIN_STORAGE) {
    throw new TerrainTileLoadError('ARTIFACT_STORAGE_UNSUPPORTED', String(header.storage ?? 'missing'));
  }
  positiveInteger(header.width, 'width');
  positiveInteger(header.height, 'height');
  if (!Array.isArray(header.bounds) || header.bounds.length !== 4) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', 'bounds must be [minE,minN,maxE,maxN]');
  }
  const [minE, minN, maxE, maxN] = header.bounds.map((value, index) => finite(value, `bounds[${index}]`));
  if (!(maxE > minE && maxN > minN)) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', 'bounds must have positive extent');
  }
  finite(header.pixel_size_m, 'pixel_size_m');
  if (!(header.pixel_size_m > 0)) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', 'pixel_size_m must be > 0');
  }
  finite(header.nodata, 'nodata');
  finite(header.elevation_min_m, 'elevation_min_m');
  finite(header.elevation_max_m, 'elevation_max_m');
  if (header.elevation_max_m < header.elevation_min_m) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', 'elevation range is inverted');
  }
  const expectedWidthM = header.width * header.pixel_size_m;
  const expectedHeightM = header.height * header.pixel_size_m;
  if (Math.abs((maxE - minE) - expectedWidthM) > 1e-6 || Math.abs((maxN - minN) - expectedHeightM) > 1e-6) {
    throw new TerrainTileLoadError('ARTIFACT_GRID_MISMATCH', 'bounds extent does not match width/height/pixel size');
  }
  return header;
}

function decodeFloat32LE(dataBytes, sampleCount) {
  const copied = dataBytes.slice();
  if (HOST_LITTLE_ENDIAN) return new Float32Array(copied.buffer, copied.byteOffset, sampleCount);
  const source = new DataView(copied.buffer, copied.byteOffset, copied.byteLength);
  const result = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) result[index] = source.getFloat32(index * 4, true);
  return result;
}

export function decodeTerrainHeightGridArtifact(artifactBytes) {
  if (!(artifactBytes instanceof Uint8Array)) {
    throw new TerrainTileLoadError('ARTIFACT_BYTES_INVALID', 'artifactBytes must be Uint8Array');
  }
  if (artifactBytes.byteLength < FIXED_PREFIX_BYTES) {
    throw new TerrainTileLoadError('ARTIFACT_TRUNCATED', `${artifactBytes.byteLength} < ${FIXED_PREFIX_BYTES}`);
  }
  for (let index = 0; index < MAGIC_BYTES.length; index += 1) {
    if (artifactBytes[index] !== MAGIC_BYTES[index]) {
      throw new TerrainTileLoadError('ARTIFACT_MAGIC_MISMATCH', `expected ${MAGIC_TEXT}`);
    }
  }

  const prefix = new DataView(artifactBytes.buffer, artifactBytes.byteOffset, artifactBytes.byteLength);
  const headerByteLength = prefix.getUint32(8, true);
  if (headerByteLength <= 1) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_INVALID', `invalid header length ${headerByteLength}`);
  }
  const dataOffset = FIXED_PREFIX_BYTES + headerByteLength;
  if (dataOffset > artifactBytes.byteLength) {
    throw new TerrainTileLoadError('ARTIFACT_TRUNCATED', 'declared header extends beyond artifact bytes');
  }

  let header;
  try {
    const headerText = new TextDecoder('utf-8', { fatal: true }).decode(artifactBytes.subarray(FIXED_PREFIX_BYTES, dataOffset));
    header = JSON.parse(headerText);
  } catch (error) {
    throw new TerrainTileLoadError('ARTIFACT_HEADER_JSON_INVALID', error instanceof Error ? error.message : String(error));
  }
  validateHeader(header);

  const sampleCount = header.width * header.height;
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0) {
    throw new TerrainTileLoadError('ARTIFACT_GRID_MISMATCH', 'sample count is not safe');
  }
  const expectedDataBytes = sampleCount * 4;
  const actualDataBytes = artifactBytes.byteLength - dataOffset;
  if (actualDataBytes !== expectedDataBytes) {
    throw new TerrainTileLoadError('ARTIFACT_DATA_SIZE_MISMATCH', `${actualDataBytes} != ${expectedDataBytes}`);
  }
  const elevations = decodeFloat32LE(artifactBytes.subarray(dataOffset), sampleCount);

  let actualMin = Infinity;
  let actualMax = -Infinity;
  for (const value of elevations) {
    if (!Number.isFinite(value) || value === header.nodata) {
      throw new TerrainTileLoadError('ARTIFACT_ELEVATION_INVALID', 'artifact contains nodata/non-finite elevation');
    }
    actualMin = Math.min(actualMin, value);
    actualMax = Math.max(actualMax, value);
  }
  if (Math.abs(actualMin - header.elevation_min_m) > 1e-5 || Math.abs(actualMax - header.elevation_max_m) > 1e-5) {
    throw new TerrainTileLoadError(
      'ARTIFACT_ELEVATION_RANGE_MISMATCH',
      `[${actualMin},${actualMax}] != [${header.elevation_min_m},${header.elevation_max_m}]`,
    );
  }

  return {
    header,
    elevations,
    headerByteLength,
    dataOffset,
    sampleCount,
  };
}

function assertWorkerResult(result, header) {
  if (!result || typeof result !== 'object') {
    throw new TerrainTileLoadError('WORKER_RESULT_INVALID', 'worker returned no result');
  }
  if (!(result.elevations instanceof Float32Array) || result.elevations.length !== header.width * header.height) {
    throw new TerrainTileLoadError('WORKER_RESULT_INVALID', 'worker did not return the complete elevation grid');
  }
  for (const [name, value] of Object.entries({
    positions: result.positions,
    normals: result.normals,
    uvs: result.uvs,
  })) {
    if (!(value instanceof Float32Array)) throw new TerrainTileLoadError('WORKER_RESULT_INVALID', `${name} must be Float32Array`);
  }
  if (!(result.indices instanceof Uint16Array) && !(result.indices instanceof Uint32Array)) {
    throw new TerrainTileLoadError('WORKER_RESULT_INVALID', 'indices must be Uint16Array or Uint32Array');
  }
  const meshByteSize = result.positions.byteLength + result.normals.byteLength + result.uvs.byteLength + result.indices.byteLength;
  if (!result.metadata || result.metadata.byteSize !== meshByteSize) {
    throw new TerrainTileLoadError('WORKER_RESULT_INVALID', `mesh byte size mismatch: ${result.metadata?.byteSize} != ${meshByteSize}`);
  }
  return meshByteSize;
}

export function createTerrainTileLoadFunction({
  resolveRuntimeInput,
  verifyBundle,
  meshWorkerClient,
  meshOptionsForTile,
  clock = monotonicNow,
} = {}) {
  if (typeof resolveRuntimeInput !== 'function') throw new TypeError('resolveRuntimeInput is required');
  if (typeof verifyBundle !== 'function') throw new TypeError('verifyBundle is required');
  if (!meshWorkerClient || typeof meshWorkerClient.build !== 'function') {
    throw new TypeError('meshWorkerClient.build is required');
  }
  if (typeof meshOptionsForTile !== 'function') throw new TypeError('meshOptionsForTile is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  return async function loadTerrainTile(tile, { signal } = {}) {
    if (!tile || typeof tile !== 'object' || typeof tile.id !== 'string' || !tile.id) {
      throw new TerrainTileLoadError('TILE_DESCRIPTOR_INVALID', 'tile.id must be a non-empty string');
    }
    throwIfAborted(signal);
    const startedAt = clock();

    const inputStartedAt = clock();
    const input = await resolveRuntimeInput(tile, { signal });
    const inputFinishedAt = clock();
    throwIfAborted(signal);
    if (!input || typeof input !== 'object' || !input.bundle || !(input.artifactBytes instanceof Uint8Array)) {
      throw new TerrainTileLoadError('RUNTIME_INPUT_INVALID', 'resolver must return {bundle, artifactBytes: Uint8Array}');
    }

    const verifyStartedAt = clock();
    const verification = await verifyBundle(input.bundle, input.artifactBytes);
    const verifyFinishedAt = clock();
    throwIfAborted(signal);
    if (!verification?.ok || verification.decision !== 'READY_FOR_RUNTIME') {
      throw new TerrainTileLoadError(
        'RUNTIME_VERIFICATION_REJECTED',
        `${verification?.code ?? 'UNKNOWN'}: ${verification?.detail ?? 'bundle/artifact rejected'}`,
      );
    }

    const artifactRef = input.bundle.artifact_ref;
    if (artifactRef?.artifact_role !== TERRAIN_ROLE) {
      throw new TerrainTileLoadError('ARTIFACT_ROLE_MISMATCH', `${artifactRef?.artifact_role ?? 'missing'} != ${TERRAIN_ROLE}`);
    }
    if (artifactRef?.media_type !== TERRAIN_MEDIA_TYPE) {
      throw new TerrainTileLoadError('ARTIFACT_MEDIA_TYPE_MISMATCH', `${artifactRef?.media_type ?? 'missing'} != ${TERRAIN_MEDIA_TYPE}`);
    }
    if (artifactRef?.tile_id !== tile.id) {
      throw new TerrainTileLoadError('TILE_BUNDLE_ID_MISMATCH', `${artifactRef?.tile_id ?? 'missing'} != ${tile.id}`);
    }

    const decodeStartedAt = clock();
    const decoded = decodeTerrainHeightGridArtifact(input.artifactBytes);
    const decodeFinishedAt = clock();
    throwIfAborted(signal);
    if (decoded.header.tile_id !== tile.id) {
      throw new TerrainTileLoadError('TILE_ARTIFACT_ID_MISMATCH', `${decoded.header.tile_id} != ${tile.id}`);
    }

    const requestedMeshOptions = await meshOptionsForTile({ tile, header: decoded.header });
    throwIfAborted(signal);
    if (!requestedMeshOptions || typeof requestedMeshOptions !== 'object') {
      throw new TerrainTileLoadError('MESH_OPTIONS_INVALID', 'meshOptionsForTile must return an object');
    }
    const workerOptions = {
      sourceWidth: decoded.header.width,
      sourceHeight: decoded.header.height,
      bounds: [...decoded.header.bounds],
      pixelSizeMeters: decoded.header.pixel_size_m,
      nodata: decoded.header.nodata,
      outputSize: requestedMeshOptions.outputSize,
      originE: requestedMeshOptions.originE,
      originN: requestedMeshOptions.originN,
      originH: requestedMeshOptions.originH,
    };

    const workerStartedAt = clock();
    let workerResult;
    try {
      workerResult = await meshWorkerClient.build({
        elevationBuffer: decoded.elevations.buffer,
        options: workerOptions,
        signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new TerrainTileLoadError('TERRAIN_MESH_BUILD_FAILED', error instanceof Error ? error.message : String(error));
    }
    const workerFinishedAt = clock();
    throwIfAborted(signal);
    const meshByteSize = assertWorkerResult(workerResult, decoded.header);
    const retainedByteSize = workerResult.elevations.byteLength + meshByteSize;
    const finishedAt = clock();

    return {
      byteSize: retainedByteSize,
      payload: {
        schema: PAYLOAD_SCHEMA,
        tileId: tile.id,
        artifact: {
          sha256: artifactRef.sha256,
          lineageHash: input.bundle.lineage_hash,
          header: decoded.header,
        },
        elevations: workerResult.elevations,
        mesh: {
          metadata: workerResult.metadata,
          positions: workerResult.positions,
          normals: workerResult.normals,
          uvs: workerResult.uvs,
          indices: workerResult.indices,
        },
        verification: {
          code: verification.code,
          reconstructed: verification.reconstructed ?? null,
        },
        timingMs: {
          resolveInput: durationMs(inputStartedAt, inputFinishedAt),
          verify: durationMs(verifyStartedAt, verifyFinishedAt),
          decode: durationMs(decodeStartedAt, decodeFinishedAt),
          workerRoundtrip: durationMs(workerStartedAt, workerFinishedAt),
          workerReported: Number.isFinite(workerResult.durationMs) ? workerResult.durationMs : null,
          total: durationMs(startedAt, finishedAt),
        },
      },
    };
  };
}
