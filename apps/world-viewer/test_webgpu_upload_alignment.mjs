import assert from 'node:assert/strict';
import { gpuUploadBytes4 } from './src/preview1WebGpuRenderer.mjs';

function sourceBytes(view) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

const oddU16 = new Uint16Array([1, 2, 3]);
const paddedOdd = gpuUploadBytes4(oddU16);
assert.equal(paddedOdd.byteLength, 8);
assert.deepEqual([...paddedOdd.slice(0, oddU16.byteLength)], [...sourceBytes(oddU16)]);
assert.deepEqual([...paddedOdd.slice(oddU16.byteLength)], [0, 0]);

const singleU16 = new Uint16Array([65535]);
const paddedSingle = gpuUploadBytes4(singleU16);
assert.equal(paddedSingle.byteLength, 4);
assert.deepEqual([...paddedSingle.slice(0, singleU16.byteLength)], [...sourceBytes(singleU16)]);
assert.deepEqual([...paddedSingle.slice(singleU16.byteLength)], [0, 0]);

const alignedF32 = new Float32Array([1, 2, 3]);
const aligned = gpuUploadBytes4(alignedF32);
assert.equal(aligned.byteLength, alignedF32.byteLength);
assert.deepEqual([...aligned], [...sourceBytes(alignedF32)]);

assert.equal(gpuUploadBytes4(new Uint8Array()), null);
console.log('WebGPU upload alignment regression: PASS');
