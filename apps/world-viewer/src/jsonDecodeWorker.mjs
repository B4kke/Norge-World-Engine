self.addEventListener('message', (event) => {
  const { id, bytes } = event?.data ?? {};
  try {
    if (!Number.isInteger(id) || !(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
      throw new Error('DECODE_WORKER_INVALID_REQUEST');
    }
    const startedAt = performance.now();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    const artifact = JSON.parse(text);
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error('DECODE_WORKER_ARTIFACT_NOT_OBJECT');
    }
    const workerDecodeMs = performance.now() - startedAt;
    self.postMessage({ id, status: 'PASS', worker_decode_ms: workerDecodeMs, artifact });
  } catch (error) {
    self.postMessage({
      id,
      status: 'ERROR',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
