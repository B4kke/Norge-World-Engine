const scratchF32 = new Float32Array(1);
const scratchU32 = new Uint32Array(scratchF32.buffer);

export function toFloat32(value) {
  scratchF32[0] = value;
  return scratchF32[0];
}

export function nextUpFloat32(value) {
  scratchF32[0] = value;
  const rounded = scratchF32[0];
  if (!Number.isFinite(rounded)) return rounded;
  if (Object.is(rounded, 0) || Object.is(rounded, -0)) {
    scratchU32[0] = 1;
    return scratchF32[0];
  }
  if (rounded > 0) scratchU32[0] += 1;
  else scratchU32[0] -= 1;
  return scratchF32[0];
}

export function float32Ulp(value) {
  const rounded = toFloat32(value);
  return Math.abs(nextUpFloat32(rounded) - rounded);
}

export function absoluteFloat32RoundTrip(worldCoordinate) {
  return toFloat32(worldCoordinate);
}

export function rebasedFloat32RoundTrip(worldCoordinate, originCoordinate) {
  return originCoordinate + toFloat32(worldCoordinate - originCoordinate);
}

export function rebasePositionsFloat64ToFloat32(source, origin, output = new Float32Array(source.length)) {
  if (!(source instanceof Float64Array)) throw new TypeError('source must be Float64Array');
  if (!(output instanceof Float32Array)) throw new TypeError('output must be Float32Array');
  if (source.length !== output.length || source.length % 3 !== 0) {
    throw new RangeError('position buffers must be equal-length xyz triples');
  }
  if (!Array.isArray(origin) || origin.length !== 3 || origin.some((value) => !Number.isFinite(value))) {
    throw new TypeError('origin must be three finite numbers');
  }

  for (let i = 0; i < source.length; i += 3) {
    output[i] = source[i] - origin[0];
    output[i + 1] = source[i + 1] - origin[1];
    output[i + 2] = source[i + 2] - origin[2];
  }
  return output;
}

export function reconstructPosition(origin, localFloat32, index = 0) {
  return [
    origin[0] + localFloat32[index],
    origin[1] + localFloat32[index + 1],
    origin[2] + localFloat32[index + 2],
  ];
}

export function maxAbsError(reference, actual) {
  if (reference.length !== actual.length) throw new RangeError('reference/actual lengths differ');
  let max = 0;
  for (let i = 0; i < reference.length; i += 1) {
    max = Math.max(max, Math.abs(reference[i] - actual[i]));
  }
  return max;
}
