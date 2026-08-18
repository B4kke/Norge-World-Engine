import {
  executeTerrainMeshWorkerJob,
  terrainMeshWorkerFailure,
} from './terrain_mesh_worker_protocol.mjs';

self.onmessage = (event) => {
  const message = event.data;
  try {
    const { result, transfer } = executeTerrainMeshWorkerJob(message);
    self.postMessage(result, transfer);
  } catch (error) {
    const failure = terrainMeshWorkerFailure(message, error);
    const transfer = failure.elevationBuffer instanceof ArrayBuffer ? [failure.elevationBuffer] : [];
    self.postMessage(failure, transfer);
  }
};
