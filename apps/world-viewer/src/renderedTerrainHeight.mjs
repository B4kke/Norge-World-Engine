// Renderer-only O(1) height on the EXACT triangles used by the visible
// regular terrain grid. Authoritative DTM heights remain unchanged.
// Return null outside the mesh; never extrapolate trees/signs into unloaded tiles.
export function sampleRenderedTerrainY(mesh, localX, localZ) {
  const p = mesh?.positions;
  if (!p || !Number.isFinite(localX) || !Number.isFinite(localZ)) return null;
  const n = Math.sqrt(p.length / 3);
  if (!Number.isInteger(n) || n < 2) return null;
  const x0 = p[0], z0 = p[2];
  const dx = p[3] - x0, dz = p[n * 3 + 2] - z0;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.abs(dx) < 1e-9 || Math.abs(dz) < 1e-9) return null;
  const gx = (localX - x0) / dx, gz = (localZ - z0) / dz;
  if (gx < -1e-6 || gz < -1e-6 || gx > n - 1 + 1e-6 || gz > n - 1 + 1e-6) return null;
  const col = Math.min(n - 2, Math.floor(Math.max(0, gx)));
  const row = Math.min(n - 2, Math.floor(Math.max(0, gz)));
  const u = Math.max(0, Math.min(1, gx - col));
  const w = Math.max(0, Math.min(1, gz - row));
  const a = p[(row * n + col) * 3 + 1];
  const b = p[(row * n + col + 1) * 3 + 1];
  const d = p[((row + 1) * n + col) * 3 + 1];
  const e = p[((row + 1) * n + col + 1) * 3 + 1];
  if (![a, b, d, e].every(Number.isFinite)) return null;
  return u + w <= 1
    ? a + (b - a) * u + (d - a) * w
    : e + (d - e) * (1 - u) + (b - e) * (1 - w);
}
