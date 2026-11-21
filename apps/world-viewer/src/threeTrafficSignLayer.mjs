import * as THREE from 'three/webgpu';
import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { sampleRenderedTerrainY } from './renderedTerrainHeight.mjs';

const SIGN_POINT_TYPE = 95;
const SIGN_PLATE_TYPE = 96;
const ORIENTATION_LINE_TYPES = new Set([99, 519, 5, 80, 9, 48, 953]);
const TRANSVERSE_LINE_TYPES = new Set([519]);
const PLATE_DEPTH_M = 0.035;
const SLOT_GAP_M = 0.055;
const FACE_EPSILON_M = 0.0205;

function finite(value, fallback = Number.NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function terrainSampler(payload) {
  const header = payload?.artifact?.header;
  if (!header || !(payload?.elevations instanceof Float32Array)) throw new TypeError('TRAFFIC_SIGN_TERRAIN_REQUIRED');
  return (easting, northing) => sampleHeightGrid(payload.elevations, {
    width: header.width,
    height: header.height,
    bounds: header.bounds,
    pixelSizeMeters: header.pixel_size_m,
    nodata: header.nodata,
    easting,
    northing,
  });
}

function localPoint(world, payload, sampleHeight, lift = 0) {
  const easting = Number(world?.[0]);
  const northing = Number(world?.[1]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) throw new Error('TRAFFIC_SIGN_WORLD_POINT_INVALID');
  const origin = payload.mesh.metadata.origin;
  const x = easting - origin[0], z = origin[1] - northing;
  const visibleY = sampleRenderedTerrainY(payload.mesh, x, z);
  const groundY = visibleY ?? (sampleHeight(easting, northing) - origin[2]);
  return new THREE.Vector3(x, groundY + lift, z);
}

function normalizeSignNumber(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^([^\s]+)(?:\s+-\s+(.+))?$/);
  return Object.freeze({
    code: (match?.[1] ?? text) || 'unknown',
    label: match?.[2] ?? '',
    raw: text,
  });
}

function cleanNvdbText(value) {
  return String(value ?? '')
    .replace(/@\d+(?:\.\d+)?@/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function supplementary(code) {
  return /^8\d\d(?:\.|$)/i.test(code);
}

function sizeScale(value) {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('under')) return 0.75;
  if (raw.includes('liten')) return 0.86;
  if (raw.includes('middels')) return 1;
  if (raw.includes('meget') || raw.includes('svært')) return 1.3;
  if (raw.includes('stor')) return 1.15;
  return 1;
}

function profileFor(feature) {
  const sign = normalizeSignNumber(feature?.properties?.Skiltnummer);
  const code = sign.code.toUpperCase();
  const scale = sizeScale(feature?.properties?.Størrelse);
  const text = cleanNvdbText(feature?.properties?.Tekst);
  let shape = 'rectangle';
  let width = 0.68;
  let height = 0.68;
  let family = 'unknown';

  if (/^1\d\d/.test(code)) {
    shape = 'triangle'; family = 'warning'; width = 0.78; height = 0.69;
  } else if (code === '202') {
    shape = 'inverted-triangle'; family = 'yield'; width = 0.78; height = 0.69;
  } else if (code === '206') {
    shape = 'diamond'; family = 'priority'; width = 0.68; height = 0.68;
  } else if (/^3\d\d/.test(code)) {
    family = code === '366' || code === '368' ? 'zone' : 'prohibition';
    shape = family === 'zone' ? 'rectangle' : 'circle';
    width = family === 'zone' ? 0.72 : 0.67;
    height = width;
  } else if (/^4\d\d/.test(code)) {
    family = 'mandatory'; shape = 'circle'; width = 0.67; height = 0.67;
  } else if (/^5\d\d/.test(code)) {
    family = code === '522' ? 'mandatory-path' : 'information';
    shape = code === '522' ? 'circle' : 'rectangle'; width = 0.67; height = 0.67;
  } else if (/^(?:U)?7\d\d/i.test(code)) {
    family = 'direction'; shape = 'rectangle';
    const textWidth = Math.min(1.9, Math.max(0.95, 0.52 + Math.max(text.length, sign.label.length) * 0.043));
    width = textWidth; height = 0.43;
  } else if (/^8\d\d/.test(code)) {
    family = 'supplementary'; shape = 'rectangle';
    width = Math.min(1.2, Math.max(0.55, 0.42 + text.length * 0.04)); height = 0.28;
  } else if (/^9\d\d/.test(code)) {
    family = 'marker'; shape = 'rectangle'; width = 0.34; height = 0.78;
  }

  return Object.freeze({
    sign,
    family,
    shape,
    width: width * scale,
    height: height * scale,
    scale,
    text,
    sourceColor: String(feature?.properties?.Farge ?? ''),
  });
}

function parentSignPointIds(relations) {
  const ids = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Number(value?.type?.id) === SIGN_POINT_TYPE && Array.isArray(value.vegobjekter)) {
      for (const id of value.vegobjekter) if (Number.isFinite(Number(id))) ids.push(Number(id));
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(relations);
  return [...new Set(ids)];
}

function signMountHeight(feature) {
  const source = finite(feature?.properties?.['Høyde over vegkant']);
  if (Number.isFinite(source) && source >= 1.2 && source <= 6) return { bottomM: source, source: true };
  return { bottomM: 1.75, source: false };
}

function distanceToSegmentSquared(point, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = point[0] - a[0];
  const wy = point[1] - a[1];
  const length2 = vx * vx + vy * vy;
  if (!(length2 > 1e-8)) return { distance2: wx * wx + wy * wy, tangent: [1, 0] };
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / length2));
  const dx = point[0] - (a[0] + vx * t);
  const dy = point[1] - (a[1] + vy * t);
  const length = Math.sqrt(length2);
  return { distance2: dx * dx + dy * dy, tangent: [vx / length, vy / length] };
}

function sequenceIdsFromSourceLocation(value) {
  const ids = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (key.toLowerCase() === 'veglenkesekvensid' && Number.isFinite(Number(child))) ids.add(Number(child));
      else visit(child);
    }
  };
  visit(value);
  return ids;
}

function buildOrientationSegments(artifact) {
  const segments = [];
  for (const feature of artifact?.features ?? []) {
    const typeId = Number(feature?.source_type_id);
    if (!ORIENTATION_LINE_TYPES.has(typeId) || feature?.geometry_type !== 'line') continue;
    const points = feature.points ?? [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      segments.push({ a, b, typeId, sequenceIds: sequenceIdsFromSourceLocation(feature.source_location), penaltyM: typeId === 99 ? 0 : typeId === 519 ? 4 : 2 });
    }
  }
  return segments;
}

function inferredRoadAxis(point, segments, preferredSequenceIds = new Set()) {
  const sequenceMatchedSegments = preferredSequenceIds.size > 0
    ? segments.filter((segment) => [...segment.sequenceIds].some((id) => preferredSequenceIds.has(id)))
    : [];
  const candidates = sequenceMatchedSegments.length > 0 ? sequenceMatchedSegments : segments;
  let best = null;
  for (const segment of candidates) {
    const candidate = distanceToSegmentSquared(point, segment.a, segment.b);
    const score = Math.sqrt(candidate.distance2) + segment.penaltyM;
    if (!best || score < best.score) best = { ...candidate, score, typeId: segment.typeId };
  }
  if (!best || Math.sqrt(best.distance2) > 32) return null;
  let [east, north] = best.tangent;
  if (TRANSVERSE_LINE_TYPES.has(best.typeId)) [east, north] = [-north, east];
  const localX = east;
  const localZ = -north;
  return Object.freeze({
    yawAlongRoad: Math.atan2(-localZ, localX),
    distanceM: Math.sqrt(best.distance2),
    sourceTypeId: best.typeId,
    sourceSequenceMatched: sequenceMatchedSegments.length > 0,
  });
}

function plateYaw(feature, axis) {
  if (!axis) return { yaw: 0, sourceSemantic: false, inferredAxis: false };
  const facing = String(feature?.properties?.['Ansiktsside, rettet mot'] ?? '').toLowerCase();
  if (!facing) return { yaw: axis.yawAlongRoad + Math.PI / 2, sourceSemantic: false, inferredAxis: true };
  const parallel = facing.includes('parallelt');
  return {
    yaw: axis.yawAlongRoad + (parallel ? 0 : Math.PI / 2),
    sourceSemantic: true,
    inferredAxis: true,
  };
}

function makeShape(shape, width, height) {
  const halfW = width / 2;
  const halfH = height / 2;
  const path = new THREE.Shape();
  if (shape === 'circle') {
    path.absarc(0, 0, Math.min(halfW, halfH), 0, Math.PI * 2, false);
  } else if (shape === 'triangle' || shape === 'inverted-triangle') {
    const flip = shape === 'inverted-triangle' ? -1 : 1;
    path.moveTo(0, flip * halfH);
    path.lineTo(halfW, -flip * halfH);
    path.lineTo(-halfW, -flip * halfH);
    path.closePath();
  } else if (shape === 'diamond') {
    path.moveTo(0, halfH);
    path.lineTo(halfW, 0);
    path.lineTo(0, -halfH);
    path.lineTo(-halfW, 0);
    path.closePath();
  } else {
    const r = Math.min(0.055, halfW * 0.18, halfH * 0.18);
    path.moveTo(-halfW + r, -halfH);
    path.lineTo(halfW - r, -halfH);
    path.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r);
    path.lineTo(halfW, halfH - r);
    path.quadraticCurveTo(halfW, halfH, halfW - r, halfH);
    path.lineTo(-halfW + r, halfH);
    path.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r);
    path.lineTo(-halfW, -halfH + r);
    path.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH);
    path.closePath();
  }
  return path;
}

function backGeometry(profile) {
  const shape = makeShape(profile.shape, profile.width, profile.height);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: PLATE_DEPTH_M,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.004,
    bevelSegments: 1,
    curveSegments: profile.shape === 'circle' ? 24 : 3,
  });
  geometry.translate(0, 0, -PLATE_DEPTH_M / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function faceGeometry(profile) {
  const geometry = new THREE.ShapeGeometry(makeShape(profile.shape, profile.width * 0.945, profile.height * 0.945), profile.shape === 'circle' ? 24 : 3);
  geometry.translate(0, 0, FACE_EPSILON_M);
  return geometry;
}

function presentationColors(profile) {
  const source = profile.sourceColor.toLowerCase();
  if (profile.family === 'warning' || profile.family === 'yield') return { background: '#ffffff', foreground: '#111111', border: '#d2212b' };
  if (profile.family === 'priority') return { background: '#f4d13d', foreground: '#111111', border: '#f4f4f1' };
  if (profile.family === 'prohibition') return { background: '#ffffff', foreground: '#111111', border: '#d2212b' };
  if (profile.family === 'mandatory' || profile.family === 'mandatory-path' || profile.family === 'information') return { background: '#1765a8', foreground: '#ffffff', border: '#ffffff' };
  if (profile.family === 'marker') return { background: '#f2cf31', foreground: '#111111', border: '#111111' };
  if (profile.family === 'direction') {
    if (source.includes('gul')) return { background: '#f0c92e', foreground: '#111111', border: '#111111' };
    if (source.includes('blå')) return { background: '#1765a8', foreground: '#ffffff', border: '#ffffff' };
    if (source.includes('hvit')) return { background: '#f5f4ef', foreground: '#111111', border: '#111111' };
  }
  return { background: '#f2f2ed', foreground: '#111111', border: '#333333' };
}

function drawArrow(ctx, cx, cy, length, angle, color = '#ffffff') {
  const ex = cx + Math.cos(angle) * length;
  const ey = cy + Math.sin(angle) * length;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(8, length * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
  const head = Math.max(16, length * 0.24);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(angle - 0.65) * head, ey - Math.sin(angle - 0.65) * head);
  ctx.lineTo(ex - Math.cos(angle + 0.65) * head, ey - Math.sin(angle + 0.65) * head);
  ctx.closePath(); ctx.fill();
}

function drawPerson(ctx, x, y, scale, color) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 6 * scale; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y - 23 * scale, 7 * scale, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y - 13 * scale); ctx.lineTo(x, y + 17 * scale); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - 4 * scale); ctx.lineTo(x - 15 * scale, y + 5 * scale); ctx.moveTo(x, y - 4 * scale); ctx.lineTo(x + 14 * scale, y + 3 * scale); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y + 17 * scale); ctx.lineTo(x - 13 * scale, y + 37 * scale); ctx.moveTo(x, y + 17 * scale); ctx.lineTo(x + 14 * scale, y + 36 * scale); ctx.stroke();
}

function drawBike(ctx, x, y, scale, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 5 * scale;
  const r = 15 * scale;
  ctx.beginPath(); ctx.arc(x - 19 * scale, y + 18 * scale, r, 0, Math.PI * 2); ctx.arc(x + 22 * scale, y + 18 * scale, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 19 * scale, y + 18 * scale); ctx.lineTo(x - 2 * scale, y - 4 * scale); ctx.lineTo(x + 8 * scale, y + 18 * scale); ctx.lineTo(x - 19 * scale, y + 18 * scale); ctx.moveTo(x - 2 * scale, y - 4 * scale); ctx.lineTo(x + 18 * scale, y - 5 * scale); ctx.lineTo(x + 22 * scale, y + 18 * scale); ctx.stroke();
}

function drawFacsimile(canvas, profile) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  const colors = presentationColors(profile);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = colors.background; ctx.fillRect(0, 0, w, h);
  const code = profile.sign.code.toUpperCase();

  if (profile.shape === 'circle') {
    ctx.fillStyle = colors.background; ctx.strokeStyle = colors.border; ctx.lineWidth = Math.max(14, w * 0.075);
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (profile.shape.includes('triangle')) {
    const inverted = profile.shape === 'inverted-triangle';
    ctx.fillStyle = colors.background; ctx.strokeStyle = colors.border; ctx.lineWidth = Math.max(13, w * 0.065); ctx.lineJoin = 'round';
    ctx.beginPath();
    if (inverted) { ctx.moveTo(w * 0.12, h * 0.13); ctx.lineTo(w * 0.88, h * 0.13); ctx.lineTo(w * 0.5, h * 0.87); }
    else { ctx.moveTo(w * 0.5, h * 0.1); ctx.lineTo(w * 0.9, h * 0.86); ctx.lineTo(w * 0.1, h * 0.86); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (profile.shape === 'diamond') {
    ctx.fillStyle = colors.background; ctx.strokeStyle = colors.border; ctx.lineWidth = Math.max(14, w * 0.07); ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.07); ctx.lineTo(w * 0.93, h * 0.5); ctx.lineTo(w * 0.5, h * 0.93); ctx.lineTo(w * 0.07, h * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillStyle = colors.background; ctx.strokeStyle = colors.border; ctx.lineWidth = Math.max(8, Math.min(w, h) * 0.055);
    ctx.fillRect(4, 4, w - 8, h - 8); ctx.strokeRect(7, 7, w - 14, h - 14);
  }

  ctx.fillStyle = colors.foreground; ctx.strokeStyle = colors.foreground;
  if (/^362\.(\d+)/.test(code)) {
    const speed = code.match(/^362\.(\d+)/)?.[1] ?? '';
    ctx.fillStyle = '#111111'; ctx.font = `700 ${Math.round(h * 0.43)}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(speed, w / 2, h / 2 + 2);
  } else if (code === '302') {
    ctx.fillStyle = '#d2212b'; ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(w * 0.24, h * 0.44, w * 0.52, h * 0.12);
  } else if (code === '404.1') {
    drawArrow(ctx, w * 0.43, h * 0.38, h * 0.31, Math.PI * 0.28, '#ffffff');
  } else if (code === '406') {
    ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 10;
    for (const angle of [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]) {
      const sx = w / 2 + Math.cos(angle) * w * 0.16;
      const sy = h / 2 + Math.sin(angle) * h * 0.16;
      drawArrow(ctx, sx, sy, h * 0.18, angle + 1.25, '#ffffff');
    }
  } else if (code === '522') {
    drawPerson(ctx, w * 0.37, h * 0.48, 0.8, '#ffffff');
    drawBike(ctx, w * 0.62, h * 0.5, 0.7, '#ffffff');
  } else if (code === '516') {
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.16); ctx.lineTo(w * 0.83, h * 0.78); ctx.lineTo(w * 0.17, h * 0.78); ctx.closePath(); ctx.fill();
    drawPerson(ctx, w * 0.5, h * 0.54, 0.55, '#111111');
  } else if (code === '512') {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(w * 0.27, h * 0.22, w * 0.46, h * 0.50);
    ctx.fillStyle = '#1765a8'; ctx.fillRect(w * 0.33, h * 0.29, w * 0.34, h * 0.21);
    ctx.beginPath(); ctx.arc(w * 0.37, h * 0.69, w * 0.04, 0, Math.PI * 2); ctx.arc(w * 0.63, h * 0.69, w * 0.04, 0, Math.PI * 2); ctx.fill();
  } else if (code.startsWith('906') || code.startsWith('902')) {
    ctx.fillStyle = '#111111';
    for (let x = -w; x < w * 2; x += w * 0.23) { ctx.save(); ctx.translate(x, 0); ctx.rotate(-0.58); ctx.fillRect(0, -h * 0.35, w * 0.11, h * 1.7); ctx.restore(); }
  } else if (profile.family === 'direction' || profile.family === 'supplementary' || profile.family === 'zone') {
    const text = profile.text || (profile.family === 'zone' ? profile.sign.label : profile.sign.label || profile.sign.code);
    const fontSize = Math.max(22, Math.min(68, Math.round((h * 0.56) / Math.max(1, text.length / 11))));
    ctx.font = `700 ${fontSize}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const words = text.split(/\s+/); const lines = []; let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width > w * 0.82 && current) { lines.push(current); current = word; } else current = candidate;
    }
    if (current) lines.push(current);
    const lineH = fontSize * 1.04;
    lines.slice(0, 3).forEach((line, index) => ctx.fillText(line, w / 2, h / 2 + (index - (Math.min(lines.length, 3) - 1) / 2) * lineH));
  } else if (profile.family === 'warning' && code === '142') {
    drawPerson(ctx, w * 0.44, h * 0.55, 0.52, '#111111');
    drawPerson(ctx, w * 0.59, h * 0.58, 0.4, '#111111');
  }
}

function artworkTexture(profile, disposables) {
  if (typeof globalThis.document?.createElement !== 'function') return null;
  const aspect = Math.max(0.5, Math.min(4, profile.width / profile.height));
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = aspect > 1.6 ? 512 : 256;
  canvas.height = aspect > 1.6 ? 256 : 256;
  drawFacsimile(canvas, profile);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  disposables.textures.add(texture);
  return texture;
}

function objectMatrix(position, yaw, horizontalOffsetM = 0) {
  const object = new THREE.Object3D();
  object.position.copy(position);
  if (horizontalOffsetM) {
    object.position.x += Math.cos(yaw) * horizontalOffsetM;
    object.position.z += -Math.sin(yaw) * horizontalOffsetM;
  }
  object.rotation.y = yaw;
  object.updateMatrix();
  return object.matrix;
}

function groupBy(values, keyFn) {
  const map = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return map;
}

function layoutForParent(plates, mountBottomM) {
  const records = plates.map((feature, sourceIndex) => {
    const profile = profileFor(feature);
    const placement = finite(feature?.properties?.Plasseringskode);
    const isSupplement = supplementary(profile.sign.code);
    return { feature, profile, sourceIndex, placement: Number.isFinite(placement) ? placement : null, isSupplement };
  });
  const main = records.filter((record) => !record.isSupplement);
  const supplements = records.filter((record) => record.isSupplement);
  const mainSlots = [...groupBy(main, (record) => record.placement == null ? 'unknown' : `p:${record.placement}`).entries()]
    .map(([key, items]) => ({ key, items, placement: items[0].placement, height: Math.max(...items.map((item) => item.profile.height)) }))
    .sort((a, b) => {
      if (a.placement == null && b.placement == null) return 0;
      if (a.placement == null) return 1;
      if (b.placement == null) return -1;
      return a.placement - b.placement;
    });

  let cursor = mountBottomM;
  for (let index = mainSlots.length - 1; index >= 0; index -= 1) {
    const slot = mainSlots[index];
    slot.centerY = cursor + slot.height / 2;
    cursor += slot.height + SLOT_GAP_M;
  }

  const supplementSlots = [...groupBy(supplements, (record) => record.placement == null ? 'supp:unknown' : `supp:${record.placement}`).entries()]
    .map(([key, items]) => ({ key, items, placement: items[0].placement, height: Math.max(...items.map((item) => item.profile.height)) }))
    .sort((a, b) => (a.placement ?? 999) - (b.placement ?? 999));
  let supplementCursor = mountBottomM - SLOT_GAP_M;
  for (const slot of supplementSlots) {
    slot.centerY = supplementCursor - slot.height / 2;
    supplementCursor -= slot.height + SLOT_GAP_M;
  }

  const placed = [];
  let presentationSpreadCount = 0;
  for (const slot of [...mainSlots, ...supplementSlots]) {
    const totalWidth = slot.items.reduce((sum, item) => sum + item.profile.width, 0) + Math.max(0, slot.items.length - 1) * 0.035;
    let offset = -totalWidth / 2;
    for (const item of slot.items) {
      const centerOffset = offset + item.profile.width / 2;
      if (slot.items.length > 1) presentationSpreadCount += 1;
      placed.push({ ...item, centerY: slot.centerY, horizontalOffsetM: centerOffset });
      offset += item.profile.width + 0.035;
    }
  }
  return { placed, presentationSpreadCount, mainSlotCount: mainSlots.length, supplementarySlotCount: supplementSlots.length };
}

function artworkKey(profile) {
  return [profile.sign.code, profile.text, profile.sourceColor, profile.family, profile.shape, profile.width.toFixed(3), profile.height.toFixed(3)].join('|');
}

export function createThreeTrafficSignLayer({ artifact, terrainPayload, profile } = {}) {
  if (artifact?.schema !== 'nwe.nvdb-street-detail-artifact/0.1-candidate') throw new TypeError('TRAFFIC_SIGN_ARTIFACT_REQUIRED');
  if (artifact?.tile_id !== terrainPayload?.artifact?.header?.tile_id) throw new Error('TRAFFIC_SIGN_TILE_MISMATCH');

  const root = new THREE.Group();
  root.name = 'NWE_NVDB_Traffic_Signs';
  const disposables = { geometries: new Set(), materials: new Set(), textures: new Set() };
  const sampleHeight = terrainSampler(terrainPayload);
  const signPoints = (artifact.features ?? []).filter((feature) => Number(feature?.source_type_id) === SIGN_POINT_TYPE && feature?.geometry_type === 'point');
  const signPlates = (artifact.features ?? []).filter((feature) => Number(feature?.source_type_id) === SIGN_PLATE_TYPE && feature?.geometry_type === 'point');
  const pointById = new Map(signPoints.map((feature) => [Number(feature.source_object_id), feature]));
  const orientationSegments = buildOrientationSegments(artifact);

  const linked = [];
  let unresolvedParentCount = 0;
  let multiParentCount = 0;
  for (const plate of signPlates) {
    const parentIds = parentSignPointIds(plate.relations);
    const resolved = parentIds.map((id) => pointById.get(id)).filter(Boolean);
    if (!resolved.length) { unresolvedParentCount += 1; continue; }
    if (resolved.length > 1) multiParentCount += 1;
    linked.push({ plate, parent: resolved[0] });
  }

  const byParent = groupBy(linked, ({ parent }) => Number(parent.source_object_id));
  const instances = [];
  let sourceMountHeightCount = 0;
  let sourceOrientationSemanticCount = 0;
  let inferredRoadAxisCount = 0;
  let sourcePlacementCodeCount = 0;
  let fallbackPlacementCount = 0;
  let presentationSlotSpreadCount = 0;
  let supplementaryPlateCount = 0;
  let sourceLocationSequenceMatchedPlateCount = 0;
  const familyCounts = {};
  const signNumberCounts = {};
  const requiredSupportTopMByParent = new Map();

  for (const entries of byParent.values()) {
    const parent = entries[0].parent;
    const mount = signMountHeight(parent);
    if (mount.source) sourceMountHeightCount += 1;
    const layout = layoutForParent(entries.map((entry) => entry.plate), mount.bottomM);
    presentationSlotSpreadCount += layout.presentationSpreadCount;
    const topM = layout.placed.reduce((max, item) => Math.max(max, item.centerY + item.profile.height / 2), mount.bottomM);
    requiredSupportTopMByParent.set(Number(parent.source_object_id), topM);
    const preferredSequenceIds = sequenceIdsFromSourceLocation(parent.source_location);
    for (const entry of entries) for (const id of sequenceIdsFromSourceLocation(entry.plate.source_location)) preferredSequenceIds.add(id);
    const axis = inferredRoadAxis(parent.point, orientationSegments, preferredSequenceIds);
    if (axis) inferredRoadAxisCount += entries.length;
    if (axis?.sourceSequenceMatched) sourceLocationSequenceMatchedPlateCount += entries.length;
    for (const item of layout.placed) {
      if (item.placement == null) fallbackPlacementCount += 1; else sourcePlacementCodeCount += 1;
      if (item.isSupplement) supplementaryPlateCount += 1;
      familyCounts[item.profile.family] = (familyCounts[item.profile.family] ?? 0) + 1;
      signNumberCounts[item.profile.sign.code] = (signNumberCounts[item.profile.sign.code] ?? 0) + 1;
      const orientation = plateYaw(item.feature, axis);
      if (orientation.sourceSemantic) sourceOrientationSemanticCount += 1;
      const ground = localPoint(parent.point, terrainPayload, sampleHeight, 0);
      instances.push({
        ...item,
        parent,
        axis,
        yaw: orientation.yaw,
        position: new THREE.Vector3(ground.x, ground.y + item.centerY, ground.z),
      });
    }
  }

  const backingMaterial = new THREE.MeshStandardMaterial({ color: 0xaeb4b5, roughness: 0.42, metalness: 0.56 });
  disposables.materials.add(backingMaterial);
  const grouped = groupBy(instances, (instance) => artworkKey(instance.profile));
  const renderedMeshes = [];
  let artworkTextureCount = 0;
  let facsimileGroupCount = 0;

  for (const [key, group] of grouped.entries()) {
    const sample = group[0];
    const back = backGeometry(sample.profile);
    const front = faceGeometry(sample.profile);
    disposables.geometries.add(back); disposables.geometries.add(front);
    const backMesh = new THREE.InstancedMesh(back, backingMaterial, group.length);
    backMesh.name = `NWE_Sign_Back_${sample.profile.sign.code}`;
    backMesh.castShadow = true; backMesh.receiveShadow = true;
    const texture = artworkTexture(sample.profile, disposables);
    if (texture) artworkTextureCount += 1;
    const colors = presentationColors(sample.profile);
    const faceMaterial = new THREE.MeshPhysicalMaterial({
      color: texture ? 0xffffff : new THREE.Color(colors.background),
      map: texture,
      side: THREE.DoubleSide,
      roughness: 0.36,
      metalness: 0.02,
      clearcoat: 0.28,
      clearcoatRoughness: 0.3,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    disposables.materials.add(faceMaterial);
    const faceMesh = new THREE.InstancedMesh(front, faceMaterial, group.length);
    faceMesh.name = `NWE_Sign_Face_${sample.profile.sign.code}`;
    faceMesh.castShadow = false; faceMesh.receiveShadow = true;
    group.forEach((instance, index) => {
      const matrix = objectMatrix(instance.position, instance.yaw, instance.horizontalOffsetM);
      backMesh.setMatrixAt(index, matrix); faceMesh.setMatrixAt(index, matrix);
    });
    backMesh.instanceMatrix.needsUpdate = true; faceMesh.instanceMatrix.needsUpdate = true;
    backMesh.computeBoundingSphere?.(); faceMesh.computeBoundingSphere?.();
    root.add(backMesh, faceMesh);
    renderedMeshes.push(backMesh, faceMesh);
    facsimileGroupCount += 1;
    void key;
  }

  const linkedParentIds = new Set(linked.map(({ parent }) => Number(parent.source_object_id)));
  const signPointsWithoutPlate = signPoints.filter((point) => !linkedParentIds.has(Number(point.source_object_id)));
  const drawCalls = renderedMeshes.length;

  function dispose() {
    root.removeFromParent();
    for (const geometry of disposables.geometries) geometry.dispose();
    for (const material of disposables.materials) material.dispose();
    for (const texture of disposables.textures) texture.dispose();
  }

  return Object.freeze({
    root,
    dispose,
    signPointsWithoutPlate: Object.freeze([...signPointsWithoutPlate]),
    requiredSupportTopMByParent,
    stats: Object.freeze({
      schema: 'nwe.three-traffic-sign-layer/0.1',
      source_sign_point_count: signPoints.length,
      source_sign_plate_count: signPlates.length,
      linked_sign_plate_count: linked.length,
      unresolved_parent_plate_count: unresolvedParentCount,
      multi_parent_plate_count: multiParentCount,
      linked_parent_sign_point_count: linkedParentIds.size,
      sign_points_without_plate_count: signPointsWithoutPlate.length,
      source_sign_mount_height_parent_count: sourceMountHeightCount,
      source_placement_code_plate_count: sourcePlacementCodeCount,
      renderer_fallback_placement_plate_count: fallbackPlacementCount,
      supplementary_plate_count: supplementaryPlateCount,
      source_orientation_semantic_plate_count: sourceOrientationSemanticCount,
      inferred_nearby_linear_axis_plate_count: inferredRoadAxisCount,
      source_location_sequence_matched_plate_count: sourceLocationSequenceMatchedPlateCount,
      orientation_linear_source_feature_count: orientationSegments.length,
      presentation_slot_spread_plate_count: presentationSlotSpreadCount,
      sign_family_counts: Object.freeze({ ...familyCounts }),
      sign_number_counts: Object.freeze({ ...signNumberCounts }),
      rendered_artwork_group_count: facsimileGroupCount,
      renderer_canvas_texture_count: artworkTextureCount,
      rendered_mesh_count: renderedMeshes.length,
      draw_calls: drawCalls,
      profile: profile?.id ?? 'unknown',
      face_artwork: 'NVDB sign identity/text/color/category mapped to renderer-authored facsimile; official Statens vegvesen artwork is the next replacement source',
      orientation_semantics: 'plate plane uses source Ansiktsside plus matching NVDB veglenkesekvensid linear evidence when available, otherwise nearest admitted street-detail linear axis; front/back 180-degree direction is deliberately unresolved and faces are double-sided',
      placement_semantics: 'NVDB Plasseringskode orders known vertical slots; equal codes share a slot and are presentation-spread horizontally; uncoded plates share an unknown slot; supplementary 8xx plates render below the non-supplement mount baseline',
      truth_guard: 'traffic sign number/text/parent relation/placement code/facing semantic are source-backed; exact physical dimensions, exact same-slot arrangement, official artwork and front-face metering direction are not claimed until separately admitted',
    }),
  });
}
