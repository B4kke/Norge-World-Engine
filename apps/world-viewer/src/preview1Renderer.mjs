import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import { installPreviewCameraControls } from './previewCameraControls.mjs';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function identity() {
  return new Float32Array([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lookAt(eye, target, up = [0, 1, 0]) {
  const z = normalize3(subtract(eye, target));
  const x = normalize3(cross(up, z));
  const y = cross(z, x);
  const out = identity();
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2];
  out[1] = y[0]; out[5] = y[1]; out[9] = y[2];
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2];
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  return out;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL program allocation failed');
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
  }
  return program;
}

function createTerrainProgram(gl) {
  return createProgram(gl, `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aNormal;
    uniform mat4 uViewProj;
    out float vHeight;
    out float vLight;
    void main() {
      gl_Position = uViewProj * vec4(aPosition, 1.0);
      vHeight = aPosition.y;
      vec3 lightDir = normalize(vec3(-0.35, 0.82, 0.42));
      vLight = 0.42 + 0.58 * max(dot(normalize(aNormal), lightDir), 0.0);
    }`, `#version 300 es
    precision highp float;
    in float vHeight;
    in float vLight;
    out vec4 outColor;
    void main() {
      float h = clamp(vHeight / 34.0, 0.0, 1.0);
      vec3 low = vec3(0.09, 0.25, 0.13);
      vec3 high = vec3(0.46, 0.54, 0.29);
      vec3 base = mix(low, high, h);
      outColor = vec4(base * vLight, 1.0);
    }`);
}

function createFlatProgram(gl) {
  return createProgram(gl, `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    uniform mat4 uViewProj;
    void main() {
      gl_Position = uViewProj * vec4(aPosition, 1.0);
    }`, `#version 300 es
    precision highp float;
    uniform vec4 uColor;
    out vec4 outColor;
    void main() { outColor = uColor; }`);
}

function createIndexedMesh(gl, positions, indices, normals = null) {
  const vao = gl.createVertexArray();
  const positionBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (!vao || !positionBuffer || !indexBuffer) throw new Error('WebGL buffer allocation failed');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  let normalBuffer = null;
  if (normals) {
    normalBuffer = gl.createBuffer();
    if (!normalBuffer) throw new Error('WebGL normal buffer allocation failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return {
    vao,
    positionBuffer,
    normalBuffer,
    indexBuffer,
    count: indices.length,
    indexType: indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
  };
}

function destroyMesh(gl, mesh) {
  if (!mesh) return;
  gl.deleteBuffer(mesh.positionBuffer);
  if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
  gl.deleteBuffer(mesh.indexBuffer);
  gl.deleteVertexArray(mesh.vao);
}

function terrainHeightSampler(payload) {
  const header = payload.artifact.header;
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

function worldPointToLocal(point, origin, sampleHeight, lift = 0) {
  const easting = Number(point?.[0]);
  const northing = Number(point?.[1]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) throw new Error('invalid world point');
  const sourceZ = Number(point?.[2]);
  const elevation = Number.isFinite(sourceZ) && sourceZ > -10000 ? sourceZ : sampleHeight(easting, northing);
  return [easting - origin.e, elevation - origin.h + lift, origin.n - northing];
}

function pushQuad(positions, indices, a, b, c, d) {
  const base = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function buildRoadRibbonGeometry(roadsArtifact, origin, sampleHeight, widthMeters = 3.2) {
  const positions = [];
  const indices = [];
  const half = widthMeters / 2;
  for (const path of roadsArtifact?.paths ?? []) {
    const points = Array.isArray(path.points) ? path.points : [];
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = worldPointToLocal(points[i], origin, sampleHeight, 0.35);
      const b = worldPointToLocal(points[i + 1], origin, sampleHeight, 0.35);
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dz);
      if (!(length > 0.001)) continue;
      const px = -dz / length * half;
      const pz = dx / length * half;
      pushQuad(positions, indices,
        [a[0] + px, a[1], a[2] + pz],
        [a[0] - px, a[1], a[2] - pz],
        [b[0] - px, b[1], b[2] - pz],
        [b[0] + px, b[1], b[2] + pz]);
    }
  }
  const IndexArray = positions.length / 3 <= 65535 ? Uint16Array : Uint32Array;
  return { positions: new Float32Array(positions), indices: new IndexArray(indices) };
}

function polygonWithoutDuplicateClosure(polygon) {
  if (!Array.isArray(polygon)) return [];
  const points = polygon.filter((point) => Array.isArray(point) && point.length >= 2);
  if (points.length > 2) {
    const first = points[0];
    const last = points.at(-1);
    if (Number(first[0]) === Number(last[0]) && Number(first[1]) === Number(last[1])) return points.slice(0, -1);
  }
  return points;
}

function appendBuilding(feature, positions, indices, origin, sampleHeight, fallbackHeight) {
  const polygon = polygonWithoutDuplicateClosure(feature.polygon);
  if (polygon.length < 3) return false;
  const height = Number.isFinite(feature.height_m) ? Number(feature.height_m) : fallbackHeight;
  const base = polygon.map((point) => {
    const e = Number(point[0]);
    const n = Number(point[1]);
    const h = sampleHeight(e, n);
    return [e - origin.e, h - origin.h + 0.08, origin.n - n];
  });
  const top = base.map((point) => [point[0], point[1] + height, point[2]]);

  for (let i = 0; i < base.length; i += 1) {
    const j = (i + 1) % base.length;
    pushQuad(positions, indices, base[i], base[j], top[j], top[i]);
  }

  // Prototype visual roof only. Building topology/roof semantics remain P1 work.
  const roofBase = positions.length / 3;
  for (const point of top) positions.push(...point);
  for (let i = 1; i + 1 < top.length; i += 1) indices.push(roofBase, roofBase + i, roofBase + i + 1);
  return true;
}

function buildBuildingGeometry(buildingsArtifact, origin, sampleHeight, { resolved, fallbackHeight = 5 } = {}) {
  const positions = [];
  const indices = [];
  let count = 0;
  for (const feature of buildingsArtifact?.features ?? []) {
    const hasHeight = Number.isFinite(feature.height_m);
    if (hasHeight !== resolved) continue;
    if (appendBuilding(feature, positions, indices, origin, sampleHeight, fallbackHeight)) count += 1;
  }
  const IndexArray = positions.length / 3 <= 65535 ? Uint16Array : Uint32Array;
  return { positions: new Float32Array(positions), indices: new IndexArray(indices), count };
}

function makeCamera() {
  return {
    yaw: -0.78,
    pitch: 0.62,
    distance: 1180,
    target: [0, 7, 0],
  };
}

function cameraEye(camera) {
  const cp = Math.cos(camera.pitch);
  return [
    camera.target[0] + Math.sin(camera.yaw) * cp * camera.distance,
    camera.target[1] + Math.sin(camera.pitch) * camera.distance,
    camera.target[2] + Math.cos(camera.yaw) * cp * camera.distance,
  ];
}

function installControls(canvas, camera, onChange) {
  return installPreviewCameraControls(canvas, camera, onChange, {
    resetCamera: () => {
      const reset = makeCamera();
      camera.yaw = reset.yaw;
      camera.pitch = reset.pitch;
      camera.distance = reset.distance;
      camera.target[0] = reset.target[0];
      camera.target[1] = reset.target[1];
      camera.target[2] = reset.target[2];
    },
  });
}

export function createPreview1Renderer({ canvas, terrainPayload, roadsArtifact, buildingsArtifact, onFrame = () => {} } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  if (!terrainPayload?.mesh?.positions || !terrainPayload?.artifact?.header) throw new TypeError('terrainPayload is required');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.025, 0.045, 0.055, 1);

  const terrainProgram = createTerrainProgram(gl);
  const flatProgram = createFlatProgram(gl);
  const terrainMesh = createIndexedMesh(gl, terrainPayload.mesh.positions, terrainPayload.mesh.indices, terrainPayload.mesh.normals);
  const header = terrainPayload.artifact.header;
  const origin = {
    e: terrainPayload.mesh.metadata.origin[0],
    n: terrainPayload.mesh.metadata.origin[1],
    h: terrainPayload.mesh.metadata.origin[2],
  };
  const sampleHeight = terrainHeightSampler(terrainPayload);
  const roads = buildRoadRibbonGeometry(roadsArtifact, origin, sampleHeight);
  const buildingsResolved = buildBuildingGeometry(buildingsArtifact, origin, sampleHeight, { resolved: true });
  const buildingsFallback = buildBuildingGeometry(buildingsArtifact, origin, sampleHeight, { resolved: false, fallbackHeight: 5 });
  const roadMesh = createIndexedMesh(gl, roads.positions, roads.indices);
  const resolvedMesh = createIndexedMesh(gl, buildingsResolved.positions, buildingsResolved.indices);
  const fallbackMesh = createIndexedMesh(gl, buildingsFallback.positions, buildingsFallback.indices);
  const camera = makeCamera();
  let dirty = true;
  let stopped = false;
  let lastDrawAt = 0;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      dirty = true;
    }
  }

  function viewProjection() {
    const projection = perspective(52 * Math.PI / 180, Math.max(0.1, canvas.width / canvas.height), 1, 5000);
    const view = lookAt(cameraEye(camera), camera.target);
    return multiply(projection, view);
  }

  function drawMesh(program, mesh, viewProj, color = null) {
    if (!mesh || mesh.count === 0) return;
    gl.useProgram(program);
    const matrixLocation = gl.getUniformLocation(program, 'uViewProj');
    gl.uniformMatrix4fv(matrixLocation, false, viewProj);
    if (color) {
      const colorLocation = gl.getUniformLocation(program, 'uColor');
      gl.uniform4fv(colorLocation, color);
    }
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    gl.bindVertexArray(null);
  }

  function draw(now) {
    if (stopped) return;
    resize();
    if (dirty) {
      dirty = false;
      const viewProj = viewProjection();
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawMesh(terrainProgram, terrainMesh, viewProj);
      drawMesh(flatProgram, roadMesh, viewProj, new Float32Array([0.18, 0.2, 0.21, 1]));
      drawMesh(flatProgram, resolvedMesh, viewProj, new Float32Array([0.66, 0.73, 0.77, 1]));
      drawMesh(flatProgram, fallbackMesh, viewProj, new Float32Array([0.48, 0.53, 0.56, 1]));
      onFrame({
        at: now,
        drawGapMs: lastDrawAt ? now - lastDrawAt : null,
        camera: {
          yaw: camera.yaw,
          pitch: camera.pitch,
          distance: camera.distance,
          target: [...camera.target],
        },
      });
      lastDrawAt = now;
    }
    requestAnimationFrame(draw);
  }

  const removeControls = installControls(canvas, camera, () => { dirty = true; });
  const observer = new ResizeObserver(() => { dirty = true; });
  observer.observe(canvas);
  requestAnimationFrame(draw);

  return {
    header,
    stats: {
      terrain_vertices: terrainPayload.mesh.metadata.vertexCount,
      terrain_triangles: terrainPayload.mesh.metadata.triangleCount,
      road_paths: roadsArtifact?.paths?.length ?? 0,
      building_footprints: buildingsArtifact?.features?.length ?? 0,
      source_backed_building_heights: buildingsResolved.count,
      unresolved_building_heights: buildingsFallback.count,
      debug_road_width_m: 3.2,
      debug_unresolved_building_height_m: 5,
    },
    invalidate() { dirty = true; },
    dispose() {
      stopped = true;
      observer.disconnect();
      removeControls();
      destroyMesh(gl, terrainMesh);
      destroyMesh(gl, roadMesh);
      destroyMesh(gl, resolvedMesh);
      destroyMesh(gl, fallbackMesh);
      gl.deleteProgram(terrainProgram);
      gl.deleteProgram(flatProgram);
    },
  };
}