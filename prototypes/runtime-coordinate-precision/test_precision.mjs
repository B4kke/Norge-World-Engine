import assert from 'node:assert/strict';
import {
  absoluteFloat32RoundTrip,
  float32Ulp,
  maxAbsError,
  rebasePositionsFloat64ToFloat32,
  rebasedFloat32RoundTrip,
  reconstructPosition,
  toFloat32,
} from './precision.mjs';

const northing = 6_677_000;
assert.equal(float32Ulp(northing), 0.5, 'Nannestad-scale northing Float32 ULP should be 0.5 m');
assert.equal(float32Ulp(611_000), 0.0625, 'Nannestad-scale easting Float32 ULP should be 6.25 cm');
assert.equal(
  absoluteFloat32RoundTrip(northing + 0.1),
  northing,
  '10 cm detail must disappear at this absolute northing magnitude',
);
assert.equal(
  absoluteFloat32RoundTrip(northing + 0.5),
  northing + 0.5,
  '0.5 m should be exactly representable at this magnitude',
);

const regionalMagnitudeProbes = [
  ['south_utm32', 440_892.1051744548, 6_429_147.611009516],
  ['mid_utm32', 569_937.3816474526, 7_030_921.370894932],
  ['north_utm33', 653_210.0894847008, 7_731_796.8302624365],
  ['far_north_utm35', 576_330.6574114808, 7_767_125.170835211],
];
for (const [id, eastingProbe, northingProbe] of regionalMagnitudeProbes) {
  assert.ok(
    float32Ulp(eastingProbe) >= 0.03125,
    `${id} easting should already have >=3.125 cm Float32 spacing`,
  );
  assert.equal(
    float32Ulp(northingProbe),
    0.5,
    `${id} northing should have 0.5 m Float32 spacing`,
  );
  const world = northingProbe + 1_000.1234567;
  const reconstructed = rebasedFloat32RoundTrip(world, northingProbe);
  assert.ok(
    Math.abs(world - reconstructed) < 0.00005,
    `${id} 1 km local rebase should reconstruct within 0.05 mm`,
  );
}

const origin = northing;
const precisionCases = [
  [1_000.1234567, 0.00005],
  [10_000.1234567, 0.0005],
  [100_000.1234567, 0.004],
  [250_000.1234567, 0.008],
  [500_000.1234567, 0.016],
  [1_000_000.1234567, 0.032],
];
for (const [local, maxError] of precisionCases) {
  const world = origin + local;
  const reconstructed = rebasedFloat32RoundTrip(world, origin);
  assert.ok(
    Math.abs(world - reconstructed) <= maxError,
    `${local} m local radius exceeded ${maxError} m error`,
  );
}

const source = new Float64Array([611_123.456789, 6_677_987.654321, 191.234567]);
const origin3 = [611_000, 6_677_000, 180];
const local = rebasePositionsFloat64ToFloat32(source, origin3);
const reconstructed = reconstructPosition(origin3, local);
assert.ok(
  maxAbsError(source, reconstructed) < 0.00003,
  '1 km-scale local reconstruction should stay below 0.03 mm for this probe',
);

// Adversarial origin-shift sequence: authoritative Float64 world coordinates are stable,
// while repeatedly mutating an already-quantized Float32 local position accumulates error.
const world = [611_123.456789, 6_677_987.654321, 191.234567];
const startOrigin = [611_000, 6_677_000, 180];
let currentOrigin = [...startOrigin];
let mutatedLocal = world.map((value, axis) => toFloat32(value - currentOrigin[axis]));
let seed = 0x9e3779b9;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
let maxRecomputedError = 0;
for (let step = 0; step < 10_000; step += 1) {
  const delta = [
    (random() - 0.5) * 2_000,
    (random() - 0.5) * 2_000,
    (random() - 0.5) * 20,
  ];
  const nextOrigin = currentOrigin.map((value, axis) => value + delta[axis]);
  mutatedLocal = mutatedLocal.map((value, axis) => toFloat32(value - delta[axis]));
  currentOrigin = nextOrigin;

  const recomputedLocal = world.map((value, axis) => toFloat32(value - currentOrigin[axis]));
  const recomputedWorld = recomputedLocal.map((value, axis) => currentOrigin[axis] + value);
  maxRecomputedError = Math.max(maxRecomputedError, maxAbsError(world, recomputedWorld));
}

const returnDelta = startOrigin.map((value, axis) => value - currentOrigin[axis]);
mutatedLocal = mutatedLocal.map((value, axis) => toFloat32(value - returnDelta[axis]));
currentOrigin = [...startOrigin];
const mutatedWorld = mutatedLocal.map((value, axis) => currentOrigin[axis] + value);
const finalMutatedError = maxAbsError(world, mutatedWorld);
const finalRecomputedLocal = world.map((value, axis) => toFloat32(value - startOrigin[axis]));
const finalRecomputedWorld = finalRecomputedLocal.map((value, axis) => startOrigin[axis] + value);
const finalRecomputedError = maxAbsError(world, finalRecomputedWorld);

assert.ok(
  maxRecomputedError < 0.004,
  `recompute-from-Float64 exceeded 4 mm during adversarial sequence: ${maxRecomputedError}`,
);
assert.ok(
  finalRecomputedError < 0.00003,
  `recompute-from-Float64 did not return to sub-0.03 mm error: ${finalRecomputedError}`,
);
assert.ok(
  finalMutatedError > 0.05,
  `mutating Float32 local coordinates did not expose expected accumulated drift: ${finalMutatedError}`,
);

console.log(JSON.stringify({
  status: 'PASS',
  regional_probe_count: regionalMagnitudeProbes.length,
  absolute_northing_ulp_m: float32Ulp(northing),
  absolute_easting_ulp_m: float32Ulp(611_000),
  adversarial_steps: 10_000,
  max_recompute_from_world64_error_mm: maxRecomputedError * 1_000,
  final_recompute_error_mm: finalRecomputedError * 1_000,
  final_mutating_local_error_mm: finalMutatedError * 1_000,
}, null, 2));
