// Renderer-only style. Building colour/roof material is NOT surveyed OSM/NHM data.
// Stable across array order, process restarts, renderer backends and tiles.
export const BUILDING_PALETTE_SCHEMA = 'nwe.building-presentation-palette/0.1';

const PALETTES = Object.freeze({
  residential: Object.freeze({
    walls: [0xf2eee5, 0xe4d6b6, 0x9e4034, 0x788b94, 0xb68c51, 0x65765e, 0xe5d9cc, 0x655a50],
    roofs: [0x55595c, 0x77716a, 0xb45b40, 0x424a50, 0x80534a, 0x33383b],
  }),
  agricultural: Object.freeze({
    walls: [0x943f32, 0xc6af8a, 0x9dafa7, 0x71443a, 0x856f5d],
    roofs: [0x767c7e, 0x98766a, 0x7b8886, 0xa5a2a0],
  }),
  auxiliary: Object.freeze({
    walls: [0xb9b9ac, 0x9faaa5, 0xc1b3a2, 0xb5a89c],
    roofs: [0x777f83, 0x86817a, 0x676f71],
  }),
  commercial: Object.freeze({
    walls: [0xb9c0be, 0xbdb8ad, 0xa9b3b8, 0xc3b6aa, 0xadafa4],
    roofs: [0x797f81, 0x6a7578, 0x8c8984, 0x9b9991],
  }),
  generic: Object.freeze({
    walls: [0xd1c8b8, 0xc8d0c6, 0xb8c1bd, 0xc6b6a4, 0xbeb5ac],
    roofs: [0x8c8881, 0x767c7d, 0x8e6760, 0x99968b],
  }),
});

export function buildingPaletteFamily(feature) {
  const kind = String(feature?.building ?? 'yes').toLowerCase();
  if (['house', 'detached', 'residential', 'terrace', 'apartments', 'semidetached_house', 'cabin'].includes(kind)) return 'residential';
  if (['farm', 'barn', 'farm_auxiliary', 'stable', 'greenhouse'].includes(kind)) return 'agricultural';
  if (['garage', 'garages', 'shed', 'carport', 'hut'].includes(kind)) return 'auxiliary';
  if (['warehouse', 'industrial', 'retail', 'commercial', 'office', 'school', 'civic'].includes(kind)) return 'commercial';
  return 'generic';
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function toLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToLinearRgb(hex) {
  return [
    toLinear((hex >>> 16) & 255),
    toLinear((hex >>> 8) & 255),
    toLinear(hex & 255),
  ];
}

export function buildingPresentationPalette(feature) {
  const family = buildingPaletteFamily(feature);
  const catalog = PALETTES[family];
  // An absent source ID is possible in narrowly scoped geometric tests; never
  // turn array order into an identity.
  const key = String(feature?.source_id ?? feature?.id ?? JSON.stringify(feature?.polygon ?? []));
  const wallHash = stableHash('wall:' + key);
  const roofHash = stableHash('roof:' + key);
  const wallIndex = wallHash % catalog.walls.length;
  const roofIndex = roofHash % catalog.roofs.length;
  const wallHex = catalog.walls[wallIndex];
  const roofHex = catalog.roofs[roofIndex];
  return Object.freeze({
    schema: BUILDING_PALETTE_SCHEMA,
    family,
    wall_key: family + ':' + wallIndex,
    roof_key: family + ':' + roofIndex,
    wall_hex: wallHex,
    roof_hex: roofHex,
    wall_rgb_linear: Object.freeze(hexToLinearRgb(wallHex)),
    roof_rgb_linear: Object.freeze(hexToLinearRgb(roofHex)),
    truth: 'deterministic-renderer-only-colour; not measured roof or facade appearance',
  });
}

// Meter-scaled texture layout variants; presentation only, not surveyed cladding.
export function buildingSurfaceStyle(feature) {
  const family = buildingPaletteFamily(feature);
  const key = String(feature?.source_id ?? feature?.id ?? JSON.stringify(feature?.polygon ?? []));
  const variant = stableHash('surface:' + key) % 3;
  const wall = family === 'commercial' ? [[1,1],[0.65,1.5],[1.5,0.8]] : [[1,2],[2,1],[1.4,1.4]];
  return Object.freeze({ variant, wall_uv: Object.freeze(wall[variant]), roof_uv: Object.freeze([[1,1],[1.5,1],[1,1.5]][variant]), offset: (stableHash('offset:' + key) % 1024) / 1024 });
}

// Renderer-only material selection, not surveyed surface types.
export function buildingMaterialSlots(feature) {
  const family = buildingPaletteFamily(feature);
  const variant = buildingSurfaceStyle(feature).variant;
  return { wall: Number(family === 'commercial' || (['residential','generic'].includes(family) && variant === 1)), roof: Number(['agricultural','commercial'].includes(family) || (family === 'auxiliary' && variant !== 0)) };
}
