import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveGraphicsProfile } from './src/graphicsProfiles.mjs';
import { createGroundPostProcessing } from './src/threeGroundPostProcessing.mjs';

let directRenders = 0;
const direct = createGroundPostProcessing({
  renderer: { render() { directRenders += 1; } },
  scene: {},
  camera: {},
  profile: resolveGraphicsProfile('balanced'),
});
assert.equal(direct.stats.enabled, false);
assert.equal(direct.stats.schema, 'nwe.ground-post-processing/0.2');
assert.deepEqual(direct.stats.effects, []);
direct.render();
assert.equal(directRenders, 1);

const source = readFileSync(new URL('./src/threeGroundPostProcessing.mjs', import.meta.url), 'utf8');

// Fixed presentation order is part of the contract: reflections, contact
// occlusion, volumetric shafts, lens bokeh, spectral bloom, lens aberration,
// film grain.
assert.match(source, /const EFFECT_ORDER = Object\.freeze\(\[[\s\S]*?screen_space_reflections[\s\S]*?ambient_occlusion[\s\S]*?god_rays[\s\S]*?depth_of_field[\s\S]*?bloom[\s\S]*?chromatic_aberration[\s\S]*?film_grain/);
for (const effect of ['screen_space_reflections', 'god_rays', 'depth_of_field', 'bloom', 'chromatic_aberration', 'film_grain']) {
  assert.ok(source.includes(`effects.push('${effect}')`), `${effect} must report itself through the effect list`);
}
assert.match(source, /effects\.push\('ambient_occlusion'\)/);
assert.match(source, /effects\.push\('bloom'\)/);

// Advanced passes must be real three/webgpu TSL passes, not custom shaders.
assert.match(source, /import \{ ssr \} from 'three\/addons\/tsl\/display\/SSRNode\.js'/);
assert.match(source, /import \{ godrays \} from 'three\/addons\/tsl\/display\/GodraysNode\.js'/);
assert.match(source, /import \{ bilateralBlur \} from 'three\/addons\/tsl\/display\/BilateralBlurNode\.js'/);
assert.match(source, /import \{ depthAwareBlend \} from 'three\/addons\/tsl\/display\/depthAwareBlend\.js'/);
assert.match(source, /import \{ dof \} from 'three\/addons\/tsl\/display\/DepthOfFieldNode\.js'/);
assert.match(source, /import \{ film \} from 'three\/addons\/tsl\/display\/FilmNode\.js'/);
assert.match(source, /import \{ chromaticAberration \} from 'three\/addons\/tsl\/display\/ChromaticAberrationNode\.js'/);
assert.match(source, /import \{ ao \} from 'three\/addons\/tsl\/display\/GTAONode\.js'/);

// Cheap and safe profiles must not secretly enable expensive screen-space work
// or MRT; only ultra pays for it.
assert.match(source, /const sceneDepth = scenePass\.getTextureNode\('depth'\);/);
assert.match(source, /ao\(sceneDepth, null, camera\)/);
assert.match(source, /mix\(float\(1\)/, 'GTAO must be strength-bounded rather than fully multiplying the scene');
assert.match(source, /scenePass\.setMRT\(mrt\(\{ output, normal: normalView \}\)\)/, 'SSR needs a view-space normal MRT slot');
assert.match(source, /if \(useGodRays && !light\?\.isLight\) throw new TypeError\('god rays require the shadow-casting sun light'\);/, 'god rays must fail closed without a light');

// The renderer must hand the shadow-casting sun down for god rays.
const rendererSource = readFileSync(new URL('./src/threeGroundRenderer.mjs', import.meta.url), 'utf8');
assert.match(rendererSource, /createGroundPostProcessing\(\{ renderer, scene, camera, profile, light: lighting\.sun \}\)/);
assert.match(rendererSource, /createGroundLighting\(scene, profile, \{ renderer \}\)/, 'the sky environment capture needs the renderer');

// Profile gating: low/balanced stay cheap, high adds contact/bloom only, ultra
// gets the full stack.
for (const id of ['low', 'balanced']) {
  const profile = resolveGraphicsProfile(id);
  assert.equal(profile.screenSpaceReflections, false, `${id} must not run SSR`);
  assert.equal(profile.godRays, false, `${id} must not run god rays`);
  assert.equal(profile.depthOfField, false, `${id} must not run bokeh`);
  assert.equal(profile.filmGrain, false, `${id} must not run film grain`);
  assert.equal(profile.chromaticAberration, false, `${id} must not run lens aberration`);
  assert.ok(profile.environmentIntensity > 0, `${id} must receive sky image-based lighting`);
}
// ultra carries the full advanced stack; high keeps contact occlusion, bloom
// and the cheap lens passes only.
const ultra = resolveGraphicsProfile('ultra');
assert.equal(ultra.screenSpaceReflections, true, 'ultra must run SSR');
assert.equal(ultra.godRays, true, 'ultra must run god rays');
assert.equal(ultra.depthOfField, true, 'ultra must run bokeh');
assert.ok(ultra.godRaySteps > 0 && Number.isFinite(ultra.godRayIntensity), 'ultra needs bounded god-ray steps');
const high = resolveGraphicsProfile('high');
assert.ok(high.bloom === true, 'high keeps bloom');
assert.equal(high.ambientOcclusion, true, 'high keeps contact occlusion');
// Measured on a headless SwiftShader capture (software WebGL2, 1440x900) the
// ultra stack cannot finish inside a capture window, so the screen-space,
// god-ray and bokeh passes stay ultra-only; high keeps the cheap lens passes.
assert.equal(resolveGraphicsProfile('high').screenSpaceReflections, false);
assert.equal(resolveGraphicsProfile('high').godRays, false);
assert.equal(resolveGraphicsProfile('high').depthOfField, false);
assert.equal(resolveGraphicsProfile('high').filmGrain, true);
assert.equal(resolveGraphicsProfile('high').chromaticAberration, true);
assert.equal(resolveGraphicsProfile('ultra').environmentIntensity >= resolveGraphicsProfile('high').environmentIntensity, true);
assert.ok(resolveGraphicsProfile('ultra').godRaySteps >= 24);

// Unknown or non-finite knobs must never silently produce a half-wired effect.
const saria = createGroundPostProcessing({
  renderer: { render() { directRenders += 1; } },
  scene: {},
  camera: {},
  profile: {
    id: 'balanced',
    ambientOcclusion: 'yes',
    bloom: 1,
    screenSpaceReflections: 'true',
    godRays: {},
    depthOfField: 'false',
    filmGrain: true,
    filmGrainIntensity: 0,
    chromaticAberration: true,
    chromaticAberrationStrength: -1,
  },
});
assert.equal(saria.stats.enabled, false);
assert.equal(saria.stats.effects.length, 0);

// God rays must fail closed when the light is missing, not render black shafts.
assert.throws(
  () => createGroundPostProcessing({
    renderer: { render() {} },
    scene: {},
    camera: {},
    profile: { ...resolveGraphicsProfile('ultra'), ambientOcclusion: false, bloom: false },
  }),
  /god rays require the shadow-casting sun light/,
);

console.log('THREE_GROUND_POST_PROCESSING_PASS');
