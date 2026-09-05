import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  GROUND_MATERIAL_CATALOG_SCHEMA,
  validateGroundMaterialCatalog,
} from './src/groundMaterialAssets.mjs';

const root = new URL('./public/assets/materials/polyhaven/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
assert.equal(validateGroundMaterialCatalog(catalog), catalog);
assert.equal(catalog.schema, GROUND_MATERIAL_CATALOG_SCHEMA);
assert.equal(catalog.license, 'CC0-1.0');
assert.equal(catalog.runtime_policy, 'same-origin-local-assets-only');
assert.deepEqual(Object.keys(catalog.assets), ['terrain', 'road_asphalt', 'building_walls', 'building_roofs']);

let fileCount = 0;
for (const [surfaceId, surface] of Object.entries(catalog.assets)) {
  assert.match(surface.source_page, /^https:\/\/polyhaven\.com\/a\//);
  for (const [mapId, descriptor] of Object.entries(surface.maps)) {
    assert.ok(!descriptor.path.includes('://'), `${surfaceId}/${mapId} must be a local path`);
    const bytes = readFileSync(new URL(descriptor.path, root));
    assert.equal(bytes.byteLength, descriptor.byte_size, `${surfaceId}/${mapId} byte size`);
    assert.equal(createHash('md5').update(bytes).digest('hex'), descriptor.md5, `${surfaceId}/${mapId} MD5`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256, `${surfaceId}/${mapId} SHA-256`);
    fileCount += 1;
  }
}
assert.equal(fileCount, 16);

assert.throws(
  () => validateGroundMaterialCatalog({ ...catalog, license: 'unknown' }),
  /POLICY_INVALID/,
);
const unsafeCatalog = structuredClone(catalog);
unsafeCatalog.assets.terrain.maps.diffuse.path = 'https://example.invalid/texture.jpg';
assert.throws(() => validateGroundMaterialCatalog(unsafeCatalog), /MAP_INVALID/);
console.log('GROUND_MATERIAL_ASSETS_PASS');
