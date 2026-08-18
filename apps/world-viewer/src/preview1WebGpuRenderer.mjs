import {
  cameraViewProjection,
  createPreviewCamera,
  createPreviewSceneGeometry,
  installPreviewSceneControls,
} from './preview1SceneGeometry.mjs';

const TERRAIN_WGSL = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
};
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) height: f32,
  @location(1) light: f32,
};

@vertex fn vs_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = uniforms.viewProj * vec4<f32>(input.position, 1.0);
  out.height = input.position.y;
  let lightDir = normalize(vec3<f32>(-0.35, 0.82, 0.42));
  out.light = 0.42 + 0.58 * max(dot(normalize(input.normal), lightDir), 0.0);
  return out;
}

@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let h = clamp(input.height / 34.0, 0.0, 1.0);
  let low = vec3<f32>(0.09, 0.25, 0.13);
  let high = vec3<f32>(0.46, 0.54, 0.29);
  let base = mix(low, high, h);
  return vec4<f32>(base * input.light, 1.0);
}
`;

const FLAT_WGSL = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex fn vs_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
  return uniforms.viewProj * vec4<f32>(position, 1.0);
}

@fragment fn fs_main() -> @location(0) vec4<f32> {
  return uniforms.color;
}
`;

function aligned4(value) {
  return Math.max(4, Math.ceil(value / 4) * 4);
}

function createGpuBuffer(device, data, usage, label) {
  const buffer = device.createBuffer({
    label,
    size: aligned4(data?.byteLength ?? 0),
    usage: usage | GPUBufferUsage.COPY_DST,
  });
  if (data?.byteLength) device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
  return buffer;
}

function createMesh(device, geometry, label, { normals = null } = {}) {
  const positionBuffer = createGpuBuffer(device, geometry.positions, GPUBufferUsage.VERTEX, `${label}-positions`);
  const normalBuffer = normals ? createGpuBuffer(device, normals, GPUBufferUsage.VERTEX, `${label}-normals`) : null;
  const indexBuffer = createGpuBuffer(device, geometry.indices, GPUBufferUsage.INDEX, `${label}-indices`);
  return {
    positionBuffer,
    normalBuffer,
    indexBuffer,
    count: geometry.indices.length,
    indexFormat: geometry.indices instanceof Uint16Array ? 'uint16' : 'uint32',
  };
}

function destroyMesh(mesh) {
  mesh?.positionBuffer?.destroy();
  mesh?.normalBuffer?.destroy();
  mesh?.indexBuffer?.destroy();
}

function createUniform(device, color, label) {
  const buffer = device.createBuffer({
    label,
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 64, new Float32Array(color));
  return buffer;
}

function writeMatrix(device, buffer, matrix) {
  device.queue.writeBuffer(buffer, 0, matrix.buffer, matrix.byteOffset, matrix.byteLength);
}

function createPipeline(device, { code, format, sampleCount, terrain }) {
  const module = device.createShaderModule({ code });
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs_main',
      buffers: terrain ? [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
      ] : [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      ],
    },
    fragment: {
      module,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
    multisample: { count: sampleCount },
  });
}

export async function createPreview1WebGpuRenderer({
  canvas,
  terrainPayload,
  roadsArtifact,
  buildingsArtifact,
  graphicsProfile,
  onFrame = () => {},
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('canvas is required');
  if (!navigator.gpu) throw new Error('WEBGPU_UNAVAILABLE');
  const profile = graphicsProfile ?? { id: 'balanced', maxDpr: 1.5, msaaSamples: 1 };
  const adapterOptions = profile.powerPreference ? { powerPreference: profile.powerPreference } : undefined;
  const adapter = await navigator.gpu.requestAdapter(adapterOptions);
  if (!adapter) throw new Error('WEBGPU_ADAPTER_UNAVAILABLE');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    device.destroy?.();
    throw new Error('WEBGPU_CANVAS_CONTEXT_UNAVAILABLE');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const scene = createPreviewSceneGeometry({ terrainPayload, roadsArtifact, buildingsArtifact });
  const sampleCount = profile.msaaSamples === 4 ? 4 : 1;
  const terrainPipeline = createPipeline(device, { code: TERRAIN_WGSL, format, sampleCount, terrain: true });
  const flatPipeline = createPipeline(device, { code: FLAT_WGSL, format, sampleCount, terrain: false });
  const terrainMesh = createMesh(device, scene.terrain, 'terrain', { normals: scene.terrain.normals });
  const roadMesh = createMesh(device, scene.roads, 'roads');
  const resolvedMesh = createMesh(device, scene.buildingsResolved, 'buildings-resolved');
  const fallbackMesh = createMesh(device, scene.buildingsFallback, 'buildings-fallback');

  const terrainUniform = createUniform(device, [1, 1, 1, 1], 'terrain-uniform');
  const roadUniform = createUniform(device, [0.18, 0.2, 0.21, 1], 'road-uniform');
  const resolvedUniform = createUniform(device, [0.66, 0.73, 0.77, 1], 'building-resolved-uniform');
  const fallbackUniform = createUniform(device, [0.48, 0.53, 0.56, 1], 'building-fallback-uniform');
  const terrainBindGroup = device.createBindGroup({
    layout: terrainPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: terrainUniform } }],
  });
  const roadBindGroup = device.createBindGroup({
    layout: flatPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: roadUniform } }],
  });
  const resolvedBindGroup = device.createBindGroup({
    layout: flatPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: resolvedUniform } }],
  });
  const fallbackBindGroup = device.createBindGroup({
    layout: flatPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: fallbackUniform } }],
  });

  const camera = createPreviewCamera();
  let dirty = true;
  let stopped = false;
  let lastDrawAt = 0;
  let depthTexture = null;
  let msaaTexture = null;
  let actualPixelRatio = 1;

  function recreateAttachments() {
    depthTexture?.destroy();
    msaaTexture?.destroy();
    depthTexture = device.createTexture({
      label: 'preview-depth',
      size: [canvas.width, canvas.height, 1],
      sampleCount,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    msaaTexture = sampleCount > 1 ? device.createTexture({
      label: 'preview-msaa',
      size: [canvas.width, canvas.height, 1],
      sampleCount,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }) : null;
  }

  function resize() {
    actualPixelRatio = Math.min(window.devicePixelRatio || 1, profile.maxDpr ?? 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * actualPixelRatio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * actualPixelRatio));
    if (canvas.width !== width || canvas.height !== height || !depthTexture) {
      canvas.width = width;
      canvas.height = height;
      recreateAttachments();
      dirty = true;
    }
  }

  function encodeMesh(pass, pipeline, mesh, bindGroup) {
    if (!mesh || mesh.count === 0) return;
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, mesh.positionBuffer);
    if (mesh.normalBuffer) pass.setVertexBuffer(1, mesh.normalBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
    pass.drawIndexed(mesh.count);
  }

  function draw(now) {
    if (stopped) return;
    resize();
    if (dirty) {
      dirty = false;
      const viewProj = cameraViewProjection(camera, canvas.width, canvas.height);
      for (const uniform of [terrainUniform, roadUniform, resolvedUniform, fallbackUniform]) writeMatrix(device, uniform, viewProj);
      const targetView = context.getCurrentTexture().createView();
      const encoder = device.createCommandEncoder({ label: 'preview-frame' });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: msaaTexture ? msaaTexture.createView() : targetView,
          resolveTarget: msaaTexture ? targetView : undefined,
          clearValue: { r: 0.025, g: 0.045, b: 0.055, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      encodeMesh(pass, terrainPipeline, terrainMesh, terrainBindGroup);
      encodeMesh(pass, flatPipeline, roadMesh, roadBindGroup);
      encodeMesh(pass, flatPipeline, resolvedMesh, resolvedBindGroup);
      encodeMesh(pass, flatPipeline, fallbackMesh, fallbackBindGroup);
      pass.end();
      device.queue.submit([encoder.finish()]);
      onFrame({
        at: now,
        drawGapMs: lastDrawAt ? now - lastDrawAt : null,
        backend: 'webgpu',
        camera: { yaw: camera.yaw, pitch: camera.pitch, distance: camera.distance },
      });
      lastDrawAt = now;
    }
    requestAnimationFrame(draw);
  }

  const removeControls = installPreviewSceneControls(canvas, camera, () => { dirty = true; });
  const observer = new ResizeObserver(() => { dirty = true; });
  observer.observe(canvas);
  device.lost.then((info) => {
    stopped = true;
    console.warn('WEBGPU_DEVICE_LOST', info?.reason, info?.message);
  });
  requestAnimationFrame(draw);

  return {
    header: scene.header,
    stats: {
      ...scene.stats,
      backend: 'webgpu',
      graphics_profile: profile.id ?? 'balanced',
      max_dpr: profile.maxDpr ?? 1.5,
      pixel_ratio: actualPixelRatio,
      msaa_samples: sampleCount,
      power_preference: profile.powerPreference ?? 'default',
    },
    invalidate() { dirty = true; },
    dispose() {
      stopped = true;
      observer.disconnect();
      removeControls();
      depthTexture?.destroy();
      msaaTexture?.destroy();
      destroyMesh(terrainMesh);
      destroyMesh(roadMesh);
      destroyMesh(resolvedMesh);
      destroyMesh(fallbackMesh);
      for (const uniform of [terrainUniform, roadUniform, resolvedUniform, fallbackUniform]) uniform.destroy();
      context.unconfigure?.();
      device.destroy?.();
    },
  };
}
