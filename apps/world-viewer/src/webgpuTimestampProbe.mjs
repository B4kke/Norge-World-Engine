const SCHEMA = 'nwe.webgpu-timestamp-probe/0.1';

function featureSetHas(features, name) {
  return Boolean(features?.has?.(name));
}

export function timestampQueryDeviceDescriptor(adapter) {
  const supported = featureSetHas(adapter?.features, 'timestamp-query');
  return {
    supported,
    descriptor: supported ? { requiredFeatures: ['timestamp-query'] } : {},
  };
}

export function interpretTimestampPair(begin, end) {
  const start = typeof begin === 'bigint' ? begin : BigInt(begin ?? 0);
  const finish = typeof end === 'bigint' ? end : BigInt(end ?? 0);
  if (start === 0n || finish === 0n) {
    return { valid: false, code: 'ZERO_TIMESTAMP', elapsed_ns: null, elapsed_ms: null };
  }
  if (finish < start) {
    return { valid: false, code: 'NON_MONOTONIC_TIMESTAMP', elapsed_ns: null, elapsed_ms: null };
  }
  const elapsed = finish - start;
  return {
    valid: true,
    code: 'PASS',
    elapsed_ns: elapsed.toString(),
    elapsed_ms: Number(elapsed) / 1_000_000,
  };
}

function unsupported(code, extra = {}) {
  return {
    schema: SCHEMA,
    status: 'UNSUPPORTED',
    code,
    control_probe_only: true,
    world_render_timing: false,
    ...extra,
  };
}

export async function runWebGpuTimestampProbe({
  gpu = globalThis.navigator?.gpu,
  powerPreference = 'high-performance',
} = {}) {
  if (!gpu?.requestAdapter) return unsupported('WEBGPU_UNAVAILABLE');

  const adapter = await gpu.requestAdapter(powerPreference ? { powerPreference } : undefined);
  if (!adapter) return unsupported('WEBGPU_ADAPTER_UNAVAILABLE');

  const selection = timestampQueryDeviceDescriptor(adapter);
  if (!selection.supported) {
    return unsupported('TIMESTAMP_QUERY_ADAPTER_UNSUPPORTED', {
      timestamp_query_adapter_supported: false,
      timestamp_query_device_enabled: false,
    });
  }

  let device;
  try {
    device = await adapter.requestDevice(selection.descriptor);
  } catch (error) {
    return {
      schema: SCHEMA,
      status: 'ERROR',
      code: 'TIMESTAMP_QUERY_DEVICE_REQUEST_FAILED',
      error: error instanceof Error ? error.message : String(error),
      timestamp_query_adapter_supported: true,
      timestamp_query_device_enabled: false,
      control_probe_only: true,
      world_render_timing: false,
    };
  }

  const enabled = featureSetHas(device.features, 'timestamp-query');
  if (!enabled) {
    device.destroy?.();
    return {
      schema: SCHEMA,
      status: 'ERROR',
      code: 'TIMESTAMP_QUERY_NOT_ENABLED_ON_DEVICE',
      timestamp_query_adapter_supported: true,
      timestamp_query_device_enabled: false,
      control_probe_only: true,
      world_render_timing: false,
    };
  }

  const querySet = device.createQuerySet({ type: 'timestamp', count: 2, label: 'nwe-timestamp-control' });
  const resolveBuffer = device.createBuffer({
    label: 'nwe-timestamp-resolve',
    size: 16,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const readBuffer = device.createBuffer({
    label: 'nwe-timestamp-readback',
    size: 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  try {
    const encoder = device.createCommandEncoder({ label: 'nwe-timestamp-control' });
    const pass = encoder.beginComputePass({
      label: 'nwe-empty-timestamp-pass',
      timestampWrites: {
        querySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      },
    });
    pass.end();
    encoder.resolveQuerySet(querySet, 0, 2, resolveBuffer, 0);
    encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, 16);
    device.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(GPUMapMode.READ);
    const bytes = readBuffer.getMappedRange().slice(0);
    const pair = new BigUint64Array(bytes);
    const timing = interpretTimestampPair(pair[0], pair[1]);
    readBuffer.unmap();

    return {
      schema: SCHEMA,
      status: timing.valid ? 'PASS' : 'INCONCLUSIVE',
      code: timing.code,
      timestamp_query_adapter_supported: true,
      timestamp_query_device_enabled: true,
      elapsed_ns: timing.elapsed_ns,
      elapsed_ms: timing.elapsed_ms,
      control_probe_only: true,
      world_render_timing: false,
      note: 'Measures an empty WebGPU compute pass only; never treat this as Nannestad render timing.',
    };
  } catch (error) {
    return {
      schema: SCHEMA,
      status: 'ERROR',
      code: 'TIMESTAMP_QUERY_EXECUTION_FAILED',
      error: error instanceof Error ? error.message : String(error),
      timestamp_query_adapter_supported: true,
      timestamp_query_device_enabled: true,
      control_probe_only: true,
      world_render_timing: false,
    };
  } finally {
    querySet.destroy?.();
    resolveBuffer.destroy?.();
    readBuffer.destroy?.();
    device.destroy?.();
  }
}
