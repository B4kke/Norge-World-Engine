import * as THREE from 'three/webgpu';
import { float, mix, pass, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';

export const GROUND_POST_PROCESS_SCHEMA = 'nwe.ground-post-processing/0.1';

export function createGroundPostProcessing({ renderer, scene, camera, profile } = {}) {
  if (!renderer || !scene || !camera || !profile) throw new TypeError('renderer, scene, camera and profile are required');
  const useAo = profile.ambientOcclusion === true;
  const useBloom = profile.bloom === true;
  if (!useAo && !useBloom) {
    return {
      stats: Object.freeze({ schema: GROUND_POST_PROCESS_SCHEMA, enabled: false, ambient_occlusion: false, bloom: false }),
      render() { renderer.render(scene, camera); },
      dispose() {},
    };
  }

  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  let output = sceneColor;
  let aoPass = null;
  let bloomPass = null;

  if (useAo) {
    aoPass = ao(scenePass.getTextureNode('depth'), null, camera);
    aoPass.resolutionScale = profile.ambientOcclusionResolutionScale ?? 0.5;
    aoPass.samples.value = profile.ambientOcclusionSamples ?? 8;
    aoPass.radius.value = profile.ambientOcclusionRadius ?? 0.3;
    aoPass.distanceFallOff.value = profile.ambientOcclusionDistanceFallOff ?? 0.7;
    const strength = profile.ambientOcclusionStrength ?? 0.35;
    const softenedOcclusion = mix(float(1), aoPass.getTextureNode().r, float(strength));
    output = output.mul(vec4(vec3(softenedOcclusion), 1));
  }

  if (useBloom) {
    bloomPass = bloom(
      sceneColor,
      profile.bloomStrength ?? 0.08,
      profile.bloomRadius ?? 0.18,
      profile.bloomThreshold ?? 1.05,
    );
    output = output.add(bloomPass);
  }

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = output;
  return {
    stats: Object.freeze({
      schema: GROUND_POST_PROCESS_SCHEMA,
      enabled: true,
      ambient_occlusion: useAo,
      ambient_occlusion_resolution_scale: useAo ? aoPass.resolutionScale : null,
      ambient_occlusion_samples: useAo ? aoPass.samples.value : 0,
      bloom: useBloom,
      bloom_strength: useBloom ? bloomPass.strength.value : 0,
      bloom_threshold: useBloom ? bloomPass.threshold.value : null,
    }),
    render() { pipeline.render(); },
    dispose() {
      pipeline.dispose();
      scenePass.dispose();
      aoPass?.dispose();
      bloomPass?.dispose();
    },
  };
}
