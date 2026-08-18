import {
  TERRAIN_MESH_JOB_SCHEMA,
  TERRAIN_MESH_RESULT_SCHEMA,
} from './terrain_mesh_worker_protocol.mjs';

let nextJobId = 1;

function abortError(reason) {
  const error = new Error(typeof reason === 'string' ? reason : 'terrain mesh job aborted');
  error.name = 'AbortError';
  return error;
}

export class TerrainMeshWorkerClient {
  constructor({
    workerFactory = () => new Worker(new URL('./terrain_mesh_worker.mjs', import.meta.url), {
      type: 'module',
      name: 'nwe-terrain-mesh',
    }),
  } = {}) {
    if (typeof workerFactory !== 'function') throw new TypeError('workerFactory must be a function');
    this.workerFactory = workerFactory;
  }

  build({ elevationBuffer, options, signal } = {}) {
    if (!(elevationBuffer instanceof ArrayBuffer)) throw new TypeError('elevationBuffer must be ArrayBuffer');
    if (!options || typeof options !== 'object') throw new TypeError('options are required');
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));

    const jobId = nextJobId++;
    const worker = this.workerFactory();
    if (!worker || typeof worker.postMessage !== 'function' || typeof worker.terminate !== 'function') {
      throw new TypeError('workerFactory must return a Worker-like object');
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener?.('abort', onAbort);
        worker.terminate();
        callback(value);
      };
      const onAbort = () => finish(reject, abortError(signal?.reason));

      worker.onmessage = (event) => {
        const message = event.data;
        if (!message || message.schema !== TERRAIN_MESH_RESULT_SCHEMA || message.jobId !== jobId) return;
        if (message.status !== 'PASS') {
          const error = new Error(message.error?.message ?? 'terrain mesh worker failed');
          error.name = message.error?.name ?? 'Error';
          if (message.elevationBuffer instanceof ArrayBuffer) error.elevationBuffer = message.elevationBuffer;
          finish(reject, error);
          return;
        }
        finish(resolve, {
          jobId,
          durationMs: message.durationMs,
          metadata: message.metadata,
          elevations: new Float32Array(message.elevationBuffer),
          positions: new Float32Array(message.positionBuffer),
          normals: new Float32Array(message.normalBuffer),
          uvs: new Float32Array(message.uvBuffer),
          indices: message.indexType === 'uint16'
            ? new Uint16Array(message.indexBuffer)
            : new Uint32Array(message.indexBuffer),
        });
      };
      worker.onerror = (event) => {
        const error = event?.error instanceof Error ? event.error : new Error(event?.message ?? 'terrain mesh worker error');
        finish(reject, error);
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });

      try {
        worker.postMessage({
          schema: TERRAIN_MESH_JOB_SCHEMA,
          jobId,
          elevationBuffer,
          options,
        }, [elevationBuffer]);
      } catch (error) {
        finish(reject, error);
      }
    });
  }
}
