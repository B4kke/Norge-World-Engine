import assert from 'node:assert/strict';

import {
  createWorldFrame,
  createWorldPosition,
} from '../../engine/world/world_contract.mjs';
import { createPhysicsSpatialFrame } from '../../engine/world/physics_state_contract.mjs';
import { runPhysicsLocalCollisionProbe } from './physics_local_collision_probe.mjs';

const worldFrame = createWorldFrame({
  id: 'nannestad-prototype-world',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});

const initialPosition = createWorldPosition(worldFrame, {
  easting: 600123.456789,
  northing: 6670123.456789,
  height: 220.123456,
});
const initialEntity = Object.freeze({
  id: 'atlas-probe-body',
  position: initialPosition,
  velocity: Object.freeze({ east: 2.75, north: -1.125, up: -0.5 }),
});
const initialPhysicsFrame = createPhysicsSpatialFrame({
  physicsFrameId: 'physics-island-a',
  worldFrame,
  epoch: 0,
  anchorWorld: createWorldPosition(worldFrame, {
    easting: 600000,
    northing: 6670000,
    height: 200,
  }),
});
const rebases = [
  { step: 900, anchorWorld: createWorldPosition(worldFrame, { easting: 600100, northing: 6670100, height: 200 }) },
  { step: 1800, anchorWorld: createWorldPosition(worldFrame, { easting: 600250, northing: 6670200, height: 205 }) },
  { step: 2700, anchorWorld: createWorldPosition(worldFrame, { easting: 599900, northing: 6669900, height: 198 }) },
];
const common = Object.freeze({
  worldFrame,
  initialPhysicsFrame,
  initialEntity,
  steps: 3600,
  dtSeconds: 1 / 60,
  floorWorldHeight: 200,
  radiusM: 0.5,
  gravityMps2: -9.81,
  restitution: 0.35,
});

function positionDeltaM(a, b) {
  return Math.max(
    Math.abs(a.position.easting - b.position.easting),
    Math.abs(a.position.northing - b.position.northing),
    Math.abs(a.position.height - b.position.height),
  );
}

function velocityDeltaMps(a, b) {
  return Math.max(
    Math.abs(a.velocity.east - b.velocity.east),
    Math.abs(a.velocity.north - b.velocity.north),
    Math.abs(a.velocity.up - b.velocity.up),
  );
}

const float64Fixed = runPhysicsLocalCollisionProbe({ ...common, precision: 'float64-local' });
const float64Rebased = runPhysicsLocalCollisionProbe({ ...common, precision: 'float64-local', rebases });
const float64RebasePositionDriftM = positionDeltaM(float64Fixed.finalEntity, float64Rebased.finalEntity);
const float64RebaseVelocityDriftMps = velocityDeltaMps(float64Fixed.finalEntity, float64Rebased.finalEntity);
assert.ok(float64RebasePositionDriftM <= 1e-9, `Float64 local rebase drift ${float64RebasePositionDriftM} m exceeded structural envelope`);
assert.ok(float64RebaseVelocityDriftMps <= 1e-12, `Float64 velocity drift ${float64RebaseVelocityDriftMps} m/s exceeded structural envelope`);
assert.equal(float64Fixed.collisionCount, float64Rebased.collisionCount);
assert.equal(float64Rebased.rebaseCount, 3);

const float32Fixed = runPhysicsLocalCollisionProbe({ ...common, precision: 'float32-local' });
const float32Rebased = runPhysicsLocalCollisionProbe({ ...common, precision: 'float32-local', rebases });
const float32RebasePositionDriftM = positionDeltaM(float32Fixed.finalEntity, float32Rebased.finalEntity);
const float32RebaseVelocityDriftMps = velocityDeltaMps(float32Fixed.finalEntity, float32Rebased.finalEntity);
assert.ok(float32RebasePositionDriftM > 1e-3, 'adversarial probe expected measurable Float32 rebase-schedule position drift');
assert.ok(float32RebasePositionDriftM < 0.05, 'probe drift exceeded its broad diagnostic guardrail; inspect algorithm/runtime changes');
assert.equal(float32Fixed.collisionCount, float32Rebased.collisionCount);
assert.ok(float32RebaseVelocityDriftMps <= 1e-6, 'translation rebases must not manufacture a material velocity jump');

const absoluteFloat32 = new Float32Array([
  initialPosition.easting,
  initialPosition.northing,
  initialPosition.height,
]);
const localFloat32 = new Float32Array([
  initialPosition.easting - initialPhysicsFrame.anchorWorld.easting,
  initialPosition.northing - initialPhysicsFrame.anchorWorld.northing,
  initialPosition.height - initialPhysicsFrame.anchorWorld.height,
]);
const absoluteFloat32ErrorM = Math.max(
  Math.abs(Number(absoluteFloat32[0]) - initialPosition.easting),
  Math.abs(Number(absoluteFloat32[1]) - initialPosition.northing),
  Math.abs(Number(absoluteFloat32[2]) - initialPosition.height),
);
const reconstructedLocalFloat32 = [
  initialPhysicsFrame.anchorWorld.easting + Number(localFloat32[0]),
  initialPhysicsFrame.anchorWorld.northing + Number(localFloat32[1]),
  initialPhysicsFrame.anchorWorld.height + Number(localFloat32[2]),
];
const localFloat32ErrorM = Math.max(
  Math.abs(reconstructedLocalFloat32[0] - initialPosition.easting),
  Math.abs(reconstructedLocalFloat32[1] - initialPosition.northing),
  Math.abs(reconstructedLocalFloat32[2] - initialPosition.height),
);
assert.ok(absoluteFloat32ErrorM > 0.01, 'large absolute Float32 control should expose centimetre-scale projected-coordinate loss');
assert.ok(localFloat32ErrorM < 1e-4, 'anchor-relative Float32 should retain sub-millimetre initial reconstruction in this probe');
assert.ok(absoluteFloat32ErrorM > localFloat32ErrorM * 1000, 'localization should materially reduce initial Float32 representation error');

assert.equal(float64Fixed.collisionCount, float32Fixed.collisionCount, 'precision candidates should encounter the same contact count in this controlled path');
assert.equal(float64Rebased.collisionCount, float32Rebased.collisionCount, 'rebase schedule should not change contact count in this controlled path');

console.log(JSON.stringify({
  status: 'ATLAS_PHYSICS_LOCAL_COLLISION_PROBE_PASS_WITH_FLOAT32_COUNTEREXAMPLE',
  evidenceClass: 'synthetic-structural-prototype',
  worldFrame: {
    horizontalCrs: worldFrame.horizontalCrs,
    verticalDatum: worldFrame.verticalDatum,
  },
  steps: common.steps,
  dtSeconds: common.dtSeconds,
  rebases: rebases.length,
  collisions: float64Fixed.collisionCount,
  maxPreResolvePenetrationM: {
    float64Fixed: float64Fixed.maxPreResolvePenetrationM,
    float32Fixed: float32Fixed.maxPreResolvePenetrationM,
  },
  float64RebasePositionDriftM,
  float64RebaseVelocityDriftMps,
  float32RebasePositionDriftM,
  float32RebaseVelocityDriftMps,
  initialRepresentationErrorM: {
    absoluteFloat32: absoluteFloat32ErrorM,
    anchorRelativeFloat32: localFloat32ErrorM,
  },
  claimCalibration: {
    physicsPrecisionPolicy: 'OPEN',
    physicsRebaseThresholdPolicy: 'OPEN',
    wholeNorwayCoordinatePolicy: 'OPEN',
    renderOriginAuthority: false,
    physicsLocalAuthority: false,
    counterexample: 'Float32 local state is not bit/rebase-schedule invariant in this moving-body contact probe',
  },
}, null, 2));
