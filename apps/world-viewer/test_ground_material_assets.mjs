import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three/webgpu';
import { readFileSync } from 'node:fs';
import {
  GROUND_MATERIAL_CATALOG_SCHEMA,
  GROUND_MATERIAL_PRESENTATION,
  validateGroundMaterialCatalog,
  createGroundMaterialLibrary,
} from './src/groundMaterialAssets.mjs';

const root = new URL('./public/assets/materials/polyhaven/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
assert.equal(validateGroundMaterialCatalog(catalog), catalog);
assert.equal(catalog.schema, GROUND_MATERIAL_CATALOG_SCHEMA);
assert.equal(catalog.license, 'CC0-1.0');
assert.equal(catalog.runtime_policy, 'same-origin-local-assets-only');
assert.deepEqual(Object.keys(catalog.assets), ['terrain', 'road_asphalt', 'building_walls', 'building_roofs']);

assert.equal(GROUND_MATERIAL_PRESENTATION.roadAsphalt.diffuseTint, 0xffffff);
assert.equal(GROUND_MATERIAL_PRESENTATION.roadAsphalt.diffuseTintSrgb, '#ffffff');
assert.equal(GROUND_MATERIAL_PRESENTATION.roadAsphalt.roughness, 0.94);
assert.equal(GROUND_MATERIAL_PRESENTATION.roadAsphalt.normalScale, 0.58);
assert.match(GROUND_MATERIAL_PRESENTATION.roadAsphalt.rationale, /without-extra-darkening-tint/);

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

const textureByUrl = new Map();
const textureLoader = {
  async loadAsync(url) {
    const texture = new THREE.Texture();
    textureByUrl.set(url, texture);
    return texture;
  },
};
let satelliteBlobReleased = 0;
const satelliteUrl = 'blob:http://localhost/accepted-sentinel-2-verified';
const testManifest = 'http://localhost/assets/materials/polyhaven/manifest.json';
const materialOptions = {
  renderer: { getMaxAnisotropy() { return 4; } },
  profile: { id: 'high', normalMaps: true, textureAnisotropy: 4 },
  terrainExtentM: [1000, 1000],
  textureLoader,
  manifestUrl: testManifest,
  fetchImpl: async () => ({ ok: true, url: testManifest, async json() { return catalog; } }),
};
const satelliteLibrary = await createGroundMaterialLibrary({
  ...materialOptions,
  groundImagery: {
    schema: 'nwe.private-ground-imagery/0.1',
    textureUrl: satelliteUrl,
    textureSha256: 'a'.repeat(64),
    textureByteSize: 1234,
    nativeGroundSampleDistanceM: 10,
    manifest: { source: { name: 'Sentinel-2', provider: 'Copernicus Sentinel-2 via Earth Search',
      redistribution: 'allowed-by-license' }, texture: { uv_semantics: 'u-west-to-east-v-north-to-south' } },
    release() { satelliteBlobReleased += 1; },
  },
});
assert.equal(satelliteLibrary.getGroundColorMode(), 'satellite');
assert.equal(satelliteLibrary.stats.ground_color_default_mode, 'satellite');
assert.deepEqual(satelliteLibrary.stats.ground_color_modes_supported, ['satellite', 'pbr']);
assert.equal(satelliteLibrary.materials.terrain.map, textureByUrl.get(satelliteUrl));
assert.equal(satelliteLibrary.materials.terrain.vertexColors, false);
for (const name of ['resolvedWall', 'resolvedRoof', 'fallbackWall', 'fallbackRoof']) {
  assert.equal(satelliteLibrary.materials[name].vertexColors, true, name + ' must use source-stable per-building tint');
  assert.equal(satelliteLibrary.materials[name].color.getHex(), 0xffffff, name + ' must not double-darken vertex color');
}
assert.equal(satelliteBlobReleased, 1, 'verified satellite byte URL must be released after texture upload');
assert.equal(satelliteLibrary.setGroundColorMode('pbr'), 'pbr');
assert.equal(satelliteLibrary.materials.terrain.vertexColors, true);
assert.notEqual(satelliteLibrary.materials.terrain.map, textureByUrl.get(satelliteUrl));
assert.equal(satelliteLibrary.setGroundColorMode('satellite'), 'satellite');
assert.equal(satelliteLibrary.materials.terrain.map, textureByUrl.get(satelliteUrl));
assert.equal(satelliteLibrary.materials.terrain.vertexColors, false);
assert.throws(() => satelliteLibrary.setGroundColorMode('ortofoto'), /GROUND_COLOR_MODE_INVALID/);
satelliteLibrary.dispose();

const fallbackLibrary = await createGroundMaterialLibrary(materialOptions);
assert.equal(fallbackLibrary.getGroundColorMode(), 'pbr');
assert.deepEqual(fallbackLibrary.stats.ground_color_modes_supported, ['pbr']);
assert.equal(fallbackLibrary.materials.terrain.vertexColors, true);
assert.throws(() => fallbackLibrary.setGroundColorMode('satellite'), /GROUND_COLOR_SATELLITE_NOT_AVAILABLE/);
fallbackLibrary.dispose();

console.log('GROUND_MATERIAL_ASSETS_PASS');
