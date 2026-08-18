export function parseBenchmarkFrameCount(value, { fallback = 180, minimum = 60 } = {}) {
  const candidate = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < minimum) {
    throw new Error(`frames must be an integer >= ${minimum}`);
  }
  return candidate;
}

export function parsePositiveInteger(value, label, fallback) {
  const candidate = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return candidate;
}
