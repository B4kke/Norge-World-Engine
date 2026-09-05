// Presentation only: split asphalt at every rendered terrain triangle boundary.
// This preserves horizontal alignment/UVs and prevents terrain piercing the road.
function clip(poly, distance) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = distance(a), db = distance(b);
    if (da >= -1e-8) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}
export function drapeRoadOnTerrain(road, terrain, lift = 0.06) {
  const p = terrain.positions;
  const n = Math.sqrt(p.length / 3);
  if (!Number.isInteger(n) || n < 2) throw new Error('Regular terrain grid required');
  const x0 = p[0], z0 = p[2];
  const dx = p[3] - x0, dz = p[n * 3 + 2] - z0;
  const positions = [], uvs = [], indices = [];
  const bound = v => Math.max(0, Math.min(n - 2, Math.floor(v)));
  for (let t = 0; t < road.indices.length; t += 3) {
    const polygon = Array.from(road.indices.slice(t, t + 3), i => [
      (road.positions[i * 3] - x0) / dx,
      (road.positions[i * 3 + 2] - z0) / dz,
      road.uvs[i * 2], road.uvs[i * 2 + 1],
    ]);
    const xs = polygon.map(v => v[0]), zs = polygon.map(v => v[1]);
    for (let r = bound(Math.min(...zs)); r <= bound(Math.max(...zs)); r++) {
      for (let c = bound(Math.min(...xs)); c <= bound(Math.max(...xs)); c++) {
        let cell = polygon;
        for (const plane of [v => v[0]-c, v => c+1-v[0], v => v[1]-r, v => r+1-v[1]]) cell = clip(cell, plane);
        for (const lower of [true, false]) {
          const part = clip(cell, v => (lower ? 1 : -1) * (1-(v[0]-c)-(v[1]-r)));
          if (part.length < 3) continue;
          const a = p[(r*n+c)*3+1], b = p[(r*n+c+1)*3+1];
          const d = p[((r+1)*n+c)*3+1], e = p[((r+1)*n+c+1)*3+1];
          const base = positions.length / 3;
          for (const v of part) {
            const u = v[0]-c, w = v[1]-r;
            const h = lower ? a+(b-a)*u+(d-a)*w : e+(d-e)*(1-u)+(b-e)*(1-w);
            positions.push(x0+v[0]*dx, h+lift, z0+v[1]*dz);
            uvs.push(v[2],v[3]);
          }
          for (let i=1;i<part.length-1;i++) indices.push(base,base+i,base+i+1);
        }
      }
    }
  }
  return { ...road, positions:new Float32Array(positions), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), metadata:{...road.metadata, surface_policy:'rendered-terrain-triangle-drape', vertex_count:positions.length/3, triangle_count:indices.length/3} };
}
