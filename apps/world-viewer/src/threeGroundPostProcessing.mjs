import * as THREE from 'three/webgpu';
import { convertToTexture, float, mix, pass, vec2, vec3, vec4 } from 'three/tsl';
import { output } from 'three/tsl';
import { normalView } from 'three/tsl';
import { mrt } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

export const GROUND_POST_PROCESS_SCHEMA = 'nwe.ground-post-processing/0.2';

// Presentation order is fixed: the beauty pass feeds screen-space reflections,
// then contact occlusion, then volumetric god rays, then lens bokeh, then
// spectral bloom, then the lens-dependent film grain and chromatic aberration.
// Order is part of the renderer-neutral presentation contract; individual
// effects stay independent and profile-gated so a slow client can disable the
// expensive ones without changing world truth.
const EFFECT_ORDER = Object.freeze([
  'screen_space_reflections',
  'ambient_occlusion',
  'god_rays',
  'depth_of_field',
  'bloom',
  'chromatic_aberration',
  'film_grain',
]);

function finiteProfileNumber(profile, key, fallback) {
  const value = profile?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createGroundPostProcessing({ renderer, scene, camera, profile, light = null } = {}) {
  if (!renderer || !scene || !camera || !profile) throw new TypeError('renderer, scene, camera and profile are required');
  const useAo = profile.ambientOcclusion === true;
  const useBloom = profile.bloom === true;
  const useSsr = profile.screenSpaceReflections === true;
  const useGodRays = profile.godRays === true;
  const useDof = profile.depthOfField === true;
  const useFilmGrain = profile.filmGrain === true && finiteProfileNumber(profile, 'filmGrainIntensity', 0) > 0;
  const useChromaticAberration = profile.chromaticAberration === true
    && finiteProfileNumber(profile, 'chromaticAberrationStrength', 0) > 0;

  if (useGodRays && !light?.isLight) throw new TypeError('god rays require the shadow-casting sun light');

  const scenePass = pass(scene, camera);
  if (useSsr) {
    // SSR needs view-space normals; the MRT pass adds a normals slot without
    // changing the beauty output that every other effect consumes.
    scenePass.setMRT(mrt({ output, normal: normalView }));
  }
  const sceneColor = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  let output_node = sceneColor;
  const effects = [];
  const disposables = [];

  if (useSsr) {
    const sceneNormals = scenePass.getTextureNode('normal');
    const strength = finiteProfileNumber(profile, 'screenSpaceReflectionsStrength', 0.4);
    const ssrPass = ssr(sceneColor, sceneDepth, sceneNormals, {
      camera,
      reflectNonMetals: true,
      // DTM/NVDB/OSM surfaces are rough dielectrics: wet roads and glazed roofs
      // get their reflection miss in the environment, so a single deterministic
      // roughness proxy is enough for this presentation-only layer.
      roughnessNode: float(finiteProfileNumber(profile, 'screenSpaceReflectionsRoughness', 0.35)),
      // Accepted PBR surfaces are dielectrics; every material keeps metalness 0.
      metalnessNode: float(0),
    });
    ssrPass.resolutionScale = finiteProfileNumber(profile, 'screenSpaceReflectionsResolutionScale', 0.75);
    ssrPass.maxLuminance.value = 2;
    ssrPass.intensity.value = strength;
    output_node = output_node.add(vec4(ssrPass.getTextureNode().rgb, 0));
    effects.push('screen_space_reflections');
    disposables.push(ssrPass);
  }

  let aoPass = null;
  if (useAo) {
    aoPass = ao(sceneDepth, null, camera);
    aoPass.resolutionScale = profile.ambientOcclusionResolutionScale ?? 0.5;
    aoPass.samples.value = profile.ambientOcclusionSamples ?? 8;
    aoPass.radius.value = profile.ambientOcclusionRadius ?? 0.3;
    aoPass.distanceFallOff.value = profile.ambientOcclusionDistanceFallOff ?? 0.7;
    const strength = profile.ambientOcclusionStrength ?? 0.35;
    const softenedOcclusion = mix(float(1), aoPass.getTextureNode().r, float(strength));
    output_node = output_node.mul(vec4(vec3(softenedOcclusion), 1));
    effects.push('ambient_occlusion');
    disposables.push(aoPass);
  }

  if (useGodRays) {
    const godRaysPass = godrays(sceneDepth, camera, light);
    godRaysPass.raymarchSteps.value = Math.round(finiteProfileNumber(profile, 'godRaySteps', 32));
    const godRaysColor = bilateralBlur(
      godRaysPass,
      null,
      Math.round(finiteProfileNumber(profile, 'godRayBlurSigma', 2)),
    );
    output_node = depthAwareBlend(convertToTexture(output_node), godRaysColor.getTextureNode(), sceneDepth, camera, {
      blendColor: float(finiteProfileNumber(profile, 'godRayIntensity', 0.4)),
      edgeRadius: finiteProfileNumber(profile, 'godRayBlendEdgeRadius', 0.1),
    });
    effects.push('god_rays');
    disposables.push(godRaysPass);
  }

  if (useDof) {
    const viewZ = scenePass.getViewZNode();
    const dofPass = dof(
      convertToTexture(output_node),
      viewZ,
      float(finiteProfileNumber(profile, 'depthOfFieldFocusM', 18)),
      float(finiteProfileNumber(profile, 'depthOfFieldFocalLengthM', 8)),
      float(finiteProfileNumber(profile, 'depthOfFieldBokehScale', 1.6)),
    );
    output_node = dofPass;
    effects.push('depth_of_field');
    disposables.push(dofPass);
  }

  let bloomPass = null;
  if (useBloom) {
    bloomPass = bloom(
      output_node,
      profile.bloomStrength ?? 0.08,
      profile.bloomRadius ?? 0.18,
      profile.bloomThreshold ?? 1.05,
    );
    output_node = output_node.add(bloomPass);
    effects.push('bloom');
    disposables.push(bloomPass);
  }

  if (useChromaticAberration) {
    output_node = chromaticAberration(
      output_node,
      finiteProfileNumber(profile, 'chromaticAberrationStrength', 0.35),
      vec2(0.5, 0.5),
      finiteProfileNumber(profile, 'chromaticAberrationScale', 1.12),
    );
    effects.push('chromatic_aberration');
  }

  if (useFilmGrain) {
    output_node = film(output_node, float(finiteProfileNumber(profile, 'filmGrainIntensity', 0.03)));
    effects.push('film_grain');
  }

  if (effects.length === 0) {
    return {
      stats: Object.freeze({
        schema: GROUND_POST_PROCESS_SCHEMA,
        enabled: false,
        effect_order: [...EFFECT_ORDER],
        effects: Object.freeze([]),
        ambient_occlusion: false,
        bloom: false,
      }),
      render() { renderer.render(scene, camera); },
      dispose() { scenePass.dispose(); },
    };
  }

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = output_node;
  return {
    stats: Object.freeze({
      schema: GROUND_POST_PROCESS_SCHEMA,
      enabled: true,
      effect_order: [...EFFECT_ORDER],
      effects: Object.freeze(effects.slice().sort((left, right) => EFFECT_ORDER.indexOf(left) - EFFECT_ORDER.indexOf(right))),
      screen_space_reflections: useSsr,
      screen_space_reflections_strength: useSsr ? finiteProfileNumber(profile, 'screenSpaceReflectionsStrength', 0.4) : null,
      screen_space_reflections_resolution_scale: useSsr ? finiteProfileNumber(profile, 'screenSpaceReflectionsResolutionScale', 0.75) : null,
      ambient_occlusion: useAo,
      ambient_occlusion_resolution_scale: useAo ? aoPass.resolutionScale : null,
      ambient_occlusion_samples: useAo ? aoPass.samples.value : 0,
      god_rays: useGodRays,
      god_ray_steps: useGodRays ? Math.round(finiteProfileNumber(profile, 'godRaySteps', 32)) : null,
      god_ray_intensity: useGodRays ? finiteProfileNumber(profile, 'godRayIntensity', 0.4) : null,
      depth_of_field: useDof,
      depth_of_field_focus_m: useDof ? finiteProfileNumber(profile, 'depthOfFieldFocusM', 18) : null,
      bloom: useBloom,
      bloom_strength: useBloom ? bloomPass.strength.value : null,
      bloom_threshold: useBloom ? bloomPass.threshold.value : null,
      chromatic_aberration: useChromaticAberration,
      chromatic_aberration_strength: useChromaticAberration ? finiteProfileNumber(profile, 'chromaticAberrationStrength', 0.35) : null,
      film_grain: useFilmGrain,
      film_grain_intensity: useFilmGrain ? finiteProfileNumber(profile, 'filmGrainIntensity', 0.03) : null,
    }),
    render() { pipeline.render(); },
    dispose() {
      pipeline.dispose();
      scenePass.dispose();
      for (const disposable of disposables) disposable?.dispose?.();
    },
  };
}
