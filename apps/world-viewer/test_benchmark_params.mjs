import assert from 'node:assert/strict';
import { parseBenchmarkFrameCount, parsePositiveInteger } from './benchmark/params.mjs';

assert.equal(parseBenchmarkFrameCount(null), 180);
assert.equal(parseBenchmarkFrameCount('60'), 60);
assert.equal(parseBenchmarkFrameCount('240'), 240);
assert.throws(() => parseBenchmarkFrameCount('abc'), /frames must be an integer >= 60/);
assert.throws(() => parseBenchmarkFrameCount('59'), /frames must be an integer >= 60/);
assert.throws(() => parseBenchmarkFrameCount('60.5'), /frames must be an integer >= 60/);
assert.equal(parsePositiveInteger(null, 'timeout-ms', 120000), 120000);
assert.equal(parsePositiveInteger('60000', 'timeout-ms', 120000), 60000);
assert.throws(() => parsePositiveInteger('NaN', 'timeout-ms', 120000), /positive integer/);
assert.throws(() => parsePositiveInteger('0', 'timeout-ms', 120000), /positive integer/);

console.log('viewer benchmark parameter regressions: PASS (10 cases)');
