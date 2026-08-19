import assert from 'node:assert/strict';
import { interpretTimestampPair, timestampQueryDeviceDescriptor } from './src/webgpuTimestampProbe.mjs';

const supported = timestampQueryDeviceDescriptor({ features: new Set(['timestamp-query']) });
assert.equal(supported.supported, true);
assert.deepEqual(supported.descriptor, { requiredFeatures: ['timestamp-query'] });

const unsupported = timestampQueryDeviceDescriptor({ features: new Set() });
assert.equal(unsupported.supported, false);
assert.deepEqual(unsupported.descriptor, {});

assert.deepEqual(interpretTimestampPair(1000n, 2501000n), {
  valid: true,
  code: 'PASS',
  elapsed_ns: '2500000',
  elapsed_ms: 2.5,
});
assert.equal(interpretTimestampPair(0n, 100n).code, 'ZERO_TIMESTAMP');
assert.equal(interpretTimestampPair(100n, 0n).code, 'ZERO_TIMESTAMP');
assert.equal(interpretTimestampPair(200n, 100n).code, 'NON_MONOTONIC_TIMESTAMP');
assert.deepEqual(interpretTimestampPair(100n, 100n), {
  valid: false,
  code: 'ZERO_DURATION_TIMESTAMP',
  elapsed_ns: null,
  elapsed_ms: null,
});

console.log('webgpu timestamp probe regressions: PASS');
