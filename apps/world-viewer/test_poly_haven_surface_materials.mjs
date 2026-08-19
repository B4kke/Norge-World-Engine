import assert from 'node:assert/strict';
import { POLY_HAVEN_SURFACE_ASSETS, loadPolyHavenSurfaceTextures } from './src/polyHavenSurfaceMaterials.mjs';

assert.deepEqual(Object.keys(POLY_HAVEN_SURFACE_ASSETS).sort(), ['road', 'roof', 'terrain', 'wall']);
for (const [role, descriptor] of Object.entries(POLY_HAVEN_SURFACE_ASSETS)) {
  assert.equal(descriptor.provider, 'Poly Haven');
  assert.equal(descriptor.license, 'CC0-1.0');
  assert.equal(descriptor.resolution, '1k');
  assert.equal(descriptor.truth_semantics, 'renderer-only-presentation');
  assert.ok(descriptor.physical_width_m > 0);
  assert.match(descriptor.asset_page_url, /^https:\/\/polyhaven\.com\/a\//);
  for (const [kind, map] of Object.entries(descriptor.maps)) {
    assert.ok(['diffuse', 'normal'].includes(kind));
    assert.match(map.url, /^https:\/\/dl\.polyhaven\.org\/file\/ph-assets\/Textures\/jpg\/1k\//, `${role}/${kind} must use a static Poly Haven download URL`);
    assert.doesNotMatch(map.url, /api\.polyhaven\.com/, 'normal runtime must not call the live Poly Haven API');
  }
}

class FakeTexture {
  constructor(url) {
    this.url = url;
    this.repeat = { values: null, set: (u, v) => { this.repeat.values = [u, v]; } };
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}
class FakeLoader {
  constructor() { this.requests = []; }
  async loadAsync(url) {
    this.requests.push(url);
    if (url.includes('grey_roof_tiles_02_nor_gl')) throw new Error('synthetic roof-normal failure');
    return new FakeTexture(url);
  }
}

const loader = new FakeLoader();
const loaded = await loadPolyHavenSurfaceTextures({
  loader,
  maxAnisotropy: 16,
  repeats: {
    terrain: [500, 500],
    road: [1.0666666667, 1.3333333333],
    wall: [1, 1],
    roof: [1, 1],
  },
});
assert.equal(loader.requests.length, 8, 'four surface roles × diffuse/normal should stay bounded to eight texture requests');
assert.equal(loaded.snapshot.requested_texture_count, 8);
assert.equal(loaded.snapshot.loaded_texture_count, 7);
assert.equal(loaded.snapshot.failed_texture_count, 1);
assert.equal(loaded.snapshot.anisotropy, 8, 'anisotropy must stay bounded');
assert.equal(loaded.snapshot.world_truth, false);
assert.deepEqual(loaded.snapshot.assets.terrain.repeat, [500, 500]);
assert.equal(loaded.snapshot.assets.roof.maps.normal, 'failed');
assert.ok(loaded.textures.roof.diffuse);
assert.equal(loaded.textures.roof.normal, null, 'a presentation map failure must fail soft rather than inventing a texture');
assert.deepEqual(loaded.textures.road.diffuse.repeat.values, [1.0666666667, 1.3333333333]);
loaded.dispose();
assert.equal(loaded.textures.road.diffuse.disposed, true);

console.log('POLY_HAVEN_SURFACE_MATERIALS_PASS');
