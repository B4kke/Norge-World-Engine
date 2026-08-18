export class TerrainMeshBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TerrainMeshBuildError';
  }
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TerrainMeshBuildError(`${label} must be finite`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TerrainMeshBuildError(`${label} must be a positive integer`);
  return value;
}

function normalize3(x, y, z) {
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) return [0, 1, 0];
  return [x / length, y / length, z / length];
}

export function sampleHeightGrid(elevations, {
  width,
  height,
  bounds,
  pixelSizeMeters = 1,
  nodata,
  easting,
  northing,
} = {}) {
  if (!(elevations instanceof Float32Array)) throw new TerrainMeshBuildError('elevations must be Float32Array');
  positiveInteger(width, 'width');
  positiveInteger(height, 'height');
  if (elevations.length !== width * height) {
    throw new TerrainMeshBuildError(`elevation sample count ${elevations.length} != ${width}x${height}`);
  }
  if (!Array.isArray(bounds) || bounds.length !== 4) throw new TerrainMeshBuildError('bounds must be [minE,minN,maxE,maxN]');
  const [minE, minN, maxE, maxN] = bounds.map((value, index) => finite(value, `bounds[${index}]`));
  finite(pixelSizeMeters, 'pixelSizeMeters');
  if (pixelSizeMeters <= 0) throw new TerrainMeshBuildError('pixelSizeMeters must be > 0');
  finite(easting, 'easting');
  finite(northing, 'northing');

  // GeoTIFF/height-grid values represent pixel centers. This intentionally
  // matches the proven Forsøk 16 DTM sampling contract.
  let fx = (easting - minE) / pixelSizeMeters - 0.5;
  let fy = (maxN - northing) / pixelSizeMeters - 0.5;
  fx = Math.max(0, Math.min(width - 1, fx));
  fy = Math.max(0, Math.min(height - 1, fy));

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const q00 = elevations[y0 * width + x0];
  const q10 = elevations[y0 * width + x1];
  const q01 = elevations[y1 * width + x0];
  const q11 = elevations[y1 * width + x1];

  for (const value of [q00, q10, q01, q11]) {
    if (!Number.isFinite(value) || (nodata != null && value === nodata)) {
      throw new TerrainMeshBuildError(`cannot bilinear-sample nodata/non-finite elevation at E${easting} N${northing}`);
    }
  }
  const top = q00 * (1 - tx) + q10 * tx;
  const bottom = q01 * (1 - tx) + q11 * tx;
  const value = top * (1 - ty) + bottom * ty;
  if (easting < minE - pixelSizeMeters || easting > maxE + pixelSizeMeters || northing < minN - pixelSizeMeters || northing > maxN + pixelSizeMeters) {
    throw new TerrainMeshBuildError('sample request lies outside terrain bounds');
  }
  return value;
}

function accumulateFaceNormal(normals, positions, ia, ib, ic) {
  const ax = positions[ia * 3];
  const ay = positions[ia * 3 + 1];
  const az = positions[ia * 3 + 2];
  const abx = positions[ib * 3] - ax;
  const aby = positions[ib * 3 + 1] - ay;
  const abz = positions[ib * 3 + 2] - az;
  const acx = positions[ic * 3] - ax;
  const acy = positions[ic * 3 + 1] - ay;
  const acz = positions[ic * 3 + 2] - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  for (const index of [ia, ib, ic]) {
    normals[index * 3] += nx;
    normals[index * 3 + 1] += ny;
    normals[index * 3 + 2] += nz;
  }
}

export function buildTerrainMeshBuffers({
  elevations,
  sourceWidth,
  sourceHeight,
  bounds,
  pixelSizeMeters = 1,
  nodata = null,
  outputSize = 129,
  originE,
  originN,
  originH,
} = {}) {
  if (!(elevations instanceof Float32Array)) throw new TerrainMeshBuildError('elevations must be Float32Array');
  positiveInteger(sourceWidth, 'sourceWidth');
  positiveInteger(sourceHeight, 'sourceHeight');
  positiveInteger(outputSize, 'outputSize');
  if (outputSize < 2) throw new TerrainMeshBuildError('outputSize must be >= 2');
  if (!Array.isArray(bounds) || bounds.length !== 4) throw new TerrainMeshBuildError('bounds must have 4 numbers');
  const [minE, minN, maxE, maxN] = bounds.map((value, index) => finite(value, `bounds[${index}]`));
  if (!(maxE > minE && maxN > minN)) throw new TerrainMeshBuildError('bounds must have positive extent');
  finite(originE, 'originE');
  finite(originN, 'originN');
  finite(originH, 'originH');
  if (elevations.length !== sourceWidth * sourceHeight) {
    throw new TerrainMeshBuildError(`elevation sample count ${elevations.length} != ${sourceWidth * sourceHeight}`);
  }

  const vertexCount = outputSize * outputSize;
  const cellCount = (outputSize - 1) * (outputSize - 1);
  const indexCount = cellCount * 6;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
  const indices = new IndexArray(indexCount);
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  let vertexOffset = 0;
  let uvOffset = 0;
  for (let row = 0; row < outputSize; row += 1) {
    const v = row / (outputSize - 1);
    const northing = maxN - v * (maxN - minN);
    for (let column = 0; column < outputSize; column += 1) {
      const u = column / (outputSize - 1);
      const easting = minE + u * (maxE - minE);
      const elevation = sampleHeightGrid(elevations, {
        width: sourceWidth,
        height: sourceHeight,
        bounds,
        pixelSizeMeters,
        nodata,
        easting,
        northing,
      });
      minHeight = Math.min(minHeight, elevation);
      maxHeight = Math.max(maxHeight, elevation);
      positions[vertexOffset] = easting - originE;
      positions[vertexOffset + 1] = elevation - originH;
      positions[vertexOffset + 2] = originN - northing;
      vertexOffset += 3;
      uvs[uvOffset] = u;
      uvs[uvOffset + 1] = 1 - v;
      uvOffset += 2;
    }
  }

  let indexOffset = 0;
  for (let row = 0; row < outputSize - 1; row += 1) {
    for (let column = 0; column < outputSize - 1; column += 1) {
      const a = row * outputSize + column;
      const b = a + 1;
      const d = (row + 1) * outputSize + column;
      const e = d + 1;
      // Same winding/topology as Forsøk 16: a,d,b and b,d,e.
      indices[indexOffset++] = a;
      indices[indexOffset++] = d;
      indices[indexOffset++] = b;
      indices[indexOffset++] = b;
      indices[indexOffset++] = d;
      indices[indexOffset++] = e;
      accumulateFaceNormal(normals, positions, a, d, b);
      accumulateFaceNormal(normals, positions, b, d, e);
    }
  }

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const [nx, ny, nz] = normalize3(normals[offset], normals[offset + 1], normals[offset + 2]);
    normals[offset] = nx;
    normals[offset + 1] = ny;
    normals[offset + 2] = nz;
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    metadata: {
      schema: 'nwe.terrain-mesh-buffers/0.1',
      sourceWidth,
      sourceHeight,
      outputSize,
      vertexCount,
      triangleCount: cellCount * 2,
      indexType: indices instanceof Uint16Array ? 'uint16' : 'uint32',
      bounds: [minE, minN, maxE, maxN],
      origin: [originE, originN, originH],
      elevationMinM: minHeight,
      elevationMaxM: maxHeight,
      byteSize: positions.byteLength + normals.byteLength + uvs.byteLength + indices.byteLength,
    },
  };
}
