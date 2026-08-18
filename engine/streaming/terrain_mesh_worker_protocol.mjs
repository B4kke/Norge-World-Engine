import { buildTerrainMeshBuffers } from './terrain_mesh_buffers.mjs';

export const TERRAIN_MESH_JOB_SCHEMA = 'nwe.terrain-mesh-worker-job/0.1';
export const TERRAIN_MESH_RESULT_SCHEMA = 'nwe.terrain-mesh-worker-result/0.1';

function transferListForResult(result, elevationBuffer) {
  return [
    elevationBuffer,
    result.positions.buffer,
    result.normals.buffer,
    result.uvs.buffer,
    result.indices.buffer,
  ];
}

export function executeTerrainMeshWorkerJob(message) {
  if (!message || message.schema !== TERRAIN_MESH_JOB_SCHEMA) {
    throw new Error(`unsupported terrain mesh worker schema: ${message?.schema ?? 'missing'}`);
  }
  if (!Number.isInteger(message.jobId) || message.jobId < 1) throw new Error('jobId must be a positive integer');
  if (!(message.elevationBuffer instanceof ArrayBuffer)) throw new Error('elevationBuffer must be ArrayBuffer');

  const elevations = new Float32Array(message.elevationBuffer);
  const started = performance.now();
  const mesh = buildTerrainMeshBuffers({ elevations, ...message.options });
  const durationMs = performance.now() - started;
  const result = {
    schema: TERRAIN_MESH_RESULT_SCHEMA,
    status: 'PASS',
    jobId: message.jobId,
    durationMs,
    metadata: mesh.metadata,
    elevationBuffer: message.elevationBuffer,
    positionBuffer: mesh.positions.buffer,
    normalBuffer: mesh.normals.buffer,
    uvBuffer: mesh.uvs.buffer,
    indexBuffer: mesh.indices.buffer,
    indexType: mesh.metadata.indexType,
  };
  return { result, transfer: transferListForResult(mesh, message.elevationBuffer) };
}

export function terrainMeshWorkerFailure(message, error) {
  return {
    schema: TERRAIN_MESH_RESULT_SCHEMA,
    status: 'FAIL',
    jobId: Number.isInteger(message?.jobId) ? message.jobId : null,
    error: {
      name: String(error?.name ?? 'Error'),
      message: String(error?.message ?? error ?? 'unknown terrain mesh worker error'),
    },
    // Return ownership of the elevation bytes even on a failed build so callers
    // do not lose the verified DTM payload solely because the render derivative failed.
    elevationBuffer: message?.elevationBuffer instanceof ArrayBuffer ? message.elevationBuffer : null,
  };
}
