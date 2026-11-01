import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  loadGroundImageryRuntime,
  validateGroundImageryManifest,
} from './src/groundImageryRuntime.mjs';

const bytes = new TextEncoder().encode('deterministic-fake-png-bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const expectedBounds = [611000, 6677000, 612000, 6678000];

function manifest(overrides = {}) {
  const value = {
    schema: 'nwe.private-ground-imagery/0.1',
    tile_id: 'epsg25832_611000_6677000_1000m',
    horizontal_crs: 'EPSG:25832',
    bounds: expectedBounds,
    texture: {
      path: 'nannestad_ground_color.png',
      sha256,
      byte_size: bytes.byteLength,
      width: 2048,
      height: 2048,
      format: 'png-rgb8',
      uv_semantics: 'u-west-to-east-v-north-to-south',
    },
    source: {
      name: 'Copernicus Sentinel-2 fixture',
      provider: 'Copernicus Sentinel-2 via Earth Search',
      rights_basis: 'Copernicus open-data fixture',
      redistribution: 'allowed-by-license',
      raw_source_committed: false,
      native_ground_sample_distance_m: 10,
      stac_item_id: 'S2B_FIXTURE',
      copernicus_notice: 'Contains modified Copernicus Sentinel data 2026',
    },
    transform: {
      geometry_displacement: false,
      sentinel_ground_truth: 'presentation-only-10m-satellite-ground-color-not-orthophoto',
    },
  };
  return {
    ...value,
    ...overrides,
    texture: { ...value.texture, ...(overrides.texture ?? {}) },
    source: { ...value.source, ...(overrides.source ?? {}) },
    transform: { ...value.transform, ...(overrides.transform ?? {}) },
  };
}

assert.equal(
  validateGroundImageryManifest(manifest(), {
    expectedTileId: 'epsg25832_611000_6677000_1000m',
    expectedBounds,
  }).texture.sha256,
  sha256,
);

assert.throws(
  () => validateGroundImageryManifest(manifest({ source: { redistribution: 'private-only' } }), {
    expectedTileId: 'epsg25832_611000_6677000_1000m',
    expectedBounds,
  }),
  /PUBLIC_REDISTRIBUTION_FORBIDDEN/,
);

assert.throws(
  () => validateGroundImageryManifest(manifest({ texture: { path: '../secret.png' } }), {
    expectedTileId: 'epsg25832_611000_6677000_1000m',
    expectedBounds,
  }),
  /TEXTURE_CONTRACT_INVALID/,
);

assert.throws(
  () => validateGroundImageryManifest(manifest({ transform: { geometry_displacement: true } }), {
    expectedTileId: 'epsg25832_611000_6677000_1000m',
    expectedBounds,
  }),
  /GEOMETRY_DISPLACEMENT_FORBIDDEN/,
);

const requests = [];
let revoked = null;
const runtime = await loadGroundImageryRuntime({
  manifestUrl: 'https://viewer.example/runtime/ground/ground-imagery.json',
  expectedTileId: 'epsg25832_611000_6677000_1000m',
  expectedBounds,
  cryptoImpl: webcrypto,
  createObjectUrl: () => 'blob:nwe-ground-fixture',
  revokeObjectUrl: (url) => { revoked = url; },
  fetchImpl: async (url) => {
    requests.push(String(url));
    if (String(url).endsWith('ground-imagery.json')) {
      return {
        ok: true,
        status: 200,
        url: String(url),
        async json() { return manifest(); },
      };
    }
    if (String(url).endsWith('nannestad_ground_color.png')) {
      return {
        ok: true,
        status: 200,
        url: String(url),
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    }
    throw new Error(`unexpected request ${url}`);
  },
});

assert.deepEqual(requests, [
  'https://viewer.example/runtime/ground/ground-imagery.json',
  'https://viewer.example/runtime/ground/nannestad_ground_color.png',
]);
assert.equal(runtime.textureSha256, sha256);
assert.equal(runtime.textureByteSize, bytes.byteLength);
assert.equal(runtime.nativeGroundSampleDistanceM, 10);
assert.equal(runtime.textureUrl, 'blob:nwe-ground-fixture');
assert.equal(runtime.truth, 'presentation-only-10m-satellite-ground-color-not-orthophoto');
runtime.release();
runtime.release();
assert.equal(revoked, 'blob:nwe-ground-fixture');

console.log('GROUND_IMAGERY_RUNTIME_PASS');
