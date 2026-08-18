import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildTerrainMeshBuffers, sampleHeightGrid } from './terrain_mesh_buffers.mjs';
import {
  executeTerrainMeshWorkerJob,
  TERRAIN_MESH_JOB_SCHEMA,
  TERRAIN_MESH_RESULT_SCHEMA,
} from './terrain_mesh_worker_protocol.mjs';
import { TerrainMeshWorkerClient } from './terrain_mesh_worker_client.mjs';

function bytes(view) {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function digestMesh(mesh) {
  const hash = crypto.createHash('sha256');
  for (const view of [mesh.positions, mesh.normals, mesh.uvs, mesh.indices]) hash.update(bytes(view));
  return hash.digest('hex');
}

function syntheticGrid(width, height) {
  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      values[row * width + column] = 180 + column * 0.75 + row * 0.25;
    }
  }
  return values;
}

const SMALL_OPTIONS = {
  sourceWidth: 4,
  sourceHeight: 4,
  bounds: [0, 0, 4, 4],
  pixelSizeMeters: 1,
  nodata: -32767,
  outputSize: 3,
  originE: 2,
  originN: 2,
  originH: 180,
};

async function testBilinearSamplingMatchesPixelCenterContract() {
  const elevations = syntheticGrid(4, 4);
  assert.equal(sampleHeightGrid(elevations, {
    width: 4,
    height: 4,
    bounds: [0, 0, 4, 4],
    pixelSizeMeters: 1,
    nodata: -32767,
    easting: 0.5,
    northing: 3.5,
  }), 180);
  assert.equal(sampleHeightGrid(elevations, {
    width: 4,
    height: 4,
    bounds: [0, 0, 4, 4],
    pixelSizeMeters: 1,
    nodata: -32767,
    easting: 1,
    northing: 3.5,
  }), 180.375);
}

async function testDeterministicMeshTopologyAndNormals() {
  const elevations = syntheticGrid(4, 4);
  const a = buildTerrainMeshBuffers({ elevations, ...SMALL_OPTIONS });
  const b = buildTerrainMeshBuffers({ elevations, ...SMALL_OPTIONS });
  assert.equal(a.metadata.vertexCount, 9);
  assert.equal(a.metadata.triangleCount, 8);
  assert.equal(a.metadata.indexType, 'uint16');
  assert.equal(a.positions.length, 27);
  assert.equal(a.normals.length, 27);
  assert.equal(a.uvs.length, 18);
  assert.equal(a.indices.length, 24);
  assert.equal(digestMesh(a), digestMesh(b));
  for (let offset = 0; offset < a.normals.length; offset += 3) {
    const length = Math.hypot(a.normals[offset], a.normals[offset + 1], a.normals[offset + 2]);
    assert.ok(Math.abs(length - 1) < 1e-5);
    assert.ok(a.normals[offset + 1] > 0, 'terrain normal must face up');
  }
}

async function testNodataFailsClosed() {
  const elevations = syntheticGrid(4, 4);
  elevations[0] = -32767;
  assert.throws(
    () => buildTerrainMeshBuffers({ elevations, ...SMALL_OPTIONS }),
    /nodata\/non-finite elevation/,
  );
}

async function testWorkerProtocolReturnsOwnershipAndTransferables() {
  const elevations = syntheticGrid(4, 4);
  const elevationBuffer = elevations.buffer.slice(0);
  const { result, transfer } = executeTerrainMeshWorkerJob({
    schema: TERRAIN_MESH_JOB_SCHEMA,
    jobId: 7,
    elevationBuffer,
    options: SMALL_OPTIONS,
  });
  assert.equal(result.schema, TERRAIN_MESH_RESULT_SCHEMA);
  assert.equal(result.status, 'PASS');
  assert.equal(result.jobId, 7);
  assert.equal(result.elevationBuffer, elevationBuffer);
  assert.equal(transfer.length, 5);
  assert.ok(transfer.every((item) => item instanceof ArrayBuffer));
  assert.equal(result.metadata.vertexCount, 9);
}

class FakeWorker {
  constructor() {
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(message) {
    queueMicrotask(() => {
      if (this.terminated) return;
      try {
        const { result } = executeTerrainMeshWorkerJob(message);
        this.onmessage?.({ data: result });
      } catch (error) {
        this.onerror?.({ error, message: error.message });
      }
    });
  }

  terminate() {
    this.terminated = true;
  }
}

class ThrowingWorker extends FakeWorker {
  postMessage() {
    throw new Error('synthetic dispatch failure');
  }
}

async function testClientRehydratesTypedBuffers() {
  const client = new TerrainMeshWorkerClient({ workerFactory: () => new FakeWorker() });
  const elevations = syntheticGrid(4, 4);
  const result = await client.build({ elevationBuffer: elevations.buffer.slice(0), options: SMALL_OPTIONS });
  assert.ok(result.elevations instanceof Float32Array);
  assert.ok(result.positions instanceof Float32Array);
  assert.ok(result.normals instanceof Float32Array);
  assert.ok(result.uvs instanceof Float32Array);
  assert.ok(result.indices instanceof Uint16Array);
  assert.equal(result.metadata.vertexCount, 9);
}

async function testClientAbortBeforeDispatchFailsClosed() {
  const controller = new AbortController();
  controller.abort('camera interest moved');
  const client = new TerrainMeshWorkerClient({ workerFactory: () => new FakeWorker() });
  await assert.rejects(
    client.build({ elevationBuffer: syntheticGrid(4, 4).buffer, options: SMALL_OPTIONS, signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
}

async function testClientDispatchFailureTerminatesWorker() {
  let worker;
  const client = new TerrainMeshWorkerClient({
    workerFactory: () => {
      worker = new ThrowingWorker();
      return worker;
    },
  });
  await assert.rejects(
    client.build({ elevationBuffer: syntheticGrid(4, 4).buffer, options: SMALL_OPTIONS }),
    /synthetic dispatch failure/,
  );
  assert.equal(worker.terminated, true, 'dispatch failure must not leak a live worker');
}

async function testRealScaleOutputShape() {
  const elevations = syntheticGrid(1000, 1000);
  const started = performance.now();
  const mesh = buildTerrainMeshBuffers({
    elevations,
    sourceWidth: 1000,
    sourceHeight: 1000,
    bounds: [611000, 6677000, 612000, 6678000],
    pixelSizeMeters: 1,
    nodata: -32767,
    outputSize: 129,
    originE: 611500,
    originN: 6677500,
    originH: 195.22,
  });
  const durationMs = performance.now() - started;
  assert.equal(mesh.metadata.vertexCount, 16641);
  assert.equal(mesh.metadata.triangleCount, 32768);
  assert.equal(mesh.metadata.indexType, 'uint16');
  assert.equal(mesh.indices.length, 98304);
  console.log(JSON.stringify({
    status: 'PASS',
    synthetic_real_scale_cpu_ms: Number(durationMs.toFixed(3)),
    vertex_count: mesh.metadata.vertexCount,
    triangle_count: mesh.metadata.triangleCount,
    output_bytes: mesh.metadata.byteSize,
    note: 'hosted/Node CPU timing is structural evidence only; Android worker timing remains required',
  }));
}

async function main() {
  await testBilinearSamplingMatchesPixelCenterContract();
  await testDeterministicMeshTopologyAndNormals();
  await testNodataFailsClosed();
  await testWorkerProtocolReturnsOwnershipAndTransferables();
  await testClientRehydratesTypedBuffers();
  await testClientAbortBeforeDispatchFailsClosed();
  await testClientDispatchFailureTerminatesWorker();
  await testRealScaleOutputShape();
  console.log('terrain mesh worker regressions: PASS (8 cases)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
