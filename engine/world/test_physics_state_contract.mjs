import assert from 'node:assert/strict';
import {
  createWorldFrame,
  createWorldPosition,
  createRenderOrigin,
  shiftRenderOrigin,
} from './world_contract.mjs';
import {
  PhysicsSpatialContractError,
  createPhysicsSpatialFrame,
  rebasePhysicsSpatialFrame,
  worldEntityToPhysicsBody,
  physicsBodyToWorldEntity,
  reframePhysicsBody,
  integratePhysicsBody,
  serializeSimulationSpatialSnapshot,
  deserializeSimulationSpatialSnapshot,
} from './physics_state_contract.mjs';

const worldFrame = createWorldFrame({ id: 'nannestad-v0.1', horizontalCrs: 'EPSG:25832', verticalDatum: 'NN2000' });
const wp = (easting, northing, height) => createWorldPosition(worldFrame, { easting, northing, height });
const entity = (id, easting, northing, height, velocity) => ({ id, position: wp(easting, northing, height), velocity });
const distance = (a, b) => Math.hypot(a.position.easting - b.position.easting, a.position.northing - b.position.northing, a.position.height - b.position.height);

const anchorA = wp(610000, 6650000, 200);
const anchorB = wp(612500, 6651200, 220);
const frameA = createPhysicsSpatialFrame({ physicsFrameId: 'physics-main', worldFrame, epoch: 0, anchorWorld: anchorA });
const moving = entity('vehicle-1', 610123.456789, 6650456.123456, 207.25, { east: 31.25, north: -4.5, up: 0.125 });

// 1. Large absolute coordinates remain reconstructable through physics-local Float64.
{
  const body = worldEntityToPhysicsBody({ worldFrame, entity: moving, physicsFrame: frameA });
  const reconstructed = physicsBodyToWorldEntity({ worldFrame, body, physicsFrame: frameA });
  assert.ok(distance(moving, reconstructed) < 1e-9);
}

// 2. Render-origin shifts cannot mutate physics/world state.
{
  const body = worldEntityToPhysicsBody({ worldFrame, entity: moving, physicsFrame: frameA });
  let renderOrigin = createRenderOrigin({ worldFrame, originSeriesId: 'camera', epoch: 0, anchorWorld: anchorA });
  for (let i = 0; i < 1000; i += 1) {
    renderOrigin = shiftRenderOrigin(worldFrame, renderOrigin, wp(anchorA.easting + i * 7, anchorA.northing - i * 3, anchorA.height)).origin;
  }
  const reconstructed = physicsBodyToWorldEntity({ worldFrame, body, physicsFrame: frameA });
  assert.ok(distance(moving, reconstructed) < 1e-9);
  assert.equal(renderOrigin.epoch, 1000);
}

// 3. Physics rebase mid-tick matches a fixed-frame integration.
{
  const baseline0 = worldEntityToPhysicsBody({ worldFrame, entity: moving, physicsFrame: frameA });
  const baseline1 = integratePhysicsBody({ body: baseline0, physicsFrame: frameA, dtSeconds: 1 });
  const baselineWorld = physicsBodyToWorldEntity({ worldFrame, body: baseline1, physicsFrame: frameA });

  const half = integratePhysicsBody({ body: baseline0, physicsFrame: frameA, dtSeconds: 0.5 });
  const rebased = rebasePhysicsSpatialFrame({ worldFrame, currentFrame: frameA, newAnchorWorld: anchorB }).frame;
  const halfReframed = reframePhysicsBody({ worldFrame, body: half, fromFrame: frameA, toFrame: rebased });
  const finalBody = integratePhysicsBody({ body: halfReframed, physicsFrame: rebased, dtSeconds: 0.5 });
  const finalWorld = physicsBodyToWorldEntity({ worldFrame, body: finalBody, physicsFrame: rebased });
  assert.ok(distance(baselineWorld, finalWorld) < 1e-9);
  assert.deepEqual(finalWorld.velocity, baselineWorld.velocity);
}

// 4. Stale physics epochs fail closed rather than being interpreted in a new local frame.
{
  const body = worldEntityToPhysicsBody({ worldFrame, entity: moving, physicsFrame: frameA });
  const rebased = rebasePhysicsSpatialFrame({ worldFrame, currentFrame: frameA, newAnchorWorld: anchorB }).frame;
  assert.throws(
    () => physicsBodyToWorldEntity({ worldFrame, body, physicsFrame: rebased }),
    (error) => error instanceof PhysicsSpatialContractError && error.code === 'PHYSICS_EPOCH_MISMATCH',
  );
}

// 5. Entity motion may cross the physics anchor without a frame change or discontinuity.
{
  const crossing = entity('crossing', anchorA.easting - 1, anchorA.northing, anchorA.height, { east: 4, north: 0, up: 0 });
  const body0 = worldEntityToPhysicsBody({ worldFrame, entity: crossing, physicsFrame: frameA });
  assert.ok(body0.localPosition[0] < 0);
  const body1 = integratePhysicsBody({ body: body0, physicsFrame: frameA, dtSeconds: 1 });
  assert.ok(body1.localPosition[0] > 0);
  const finalWorld = physicsBodyToWorldEntity({ worldFrame, body: body1, physicsFrame: frameA });
  assert.equal(finalWorld.position.easting, crossing.position.easting + 4);
}

// 6. Authoritative simulation serialization is byte-identical across physics rebase schedules.
{
  const initial = [moving, entity('ped-2', 610222.25, 6650999.5, 205, { east: 1.2, north: 0.25, up: 0 })];
  const fixedBodies = initial.map((value) => worldEntityToPhysicsBody({ worldFrame, entity: value, physicsFrame: frameA }));
  const fixedFinal = fixedBodies.map((body) => integratePhysicsBody({ body, physicsFrame: frameA, dtSeconds: 2 }));
  const fixedSnapshot = serializeSimulationSpatialSnapshot({ worldFrame, tick: 120, bodies: fixedFinal, physicsFrame: frameA });

  const rebased = rebasePhysicsSpatialFrame({ worldFrame, currentFrame: frameA, newAnchorWorld: anchorB }).frame;
  const movedBodies = fixedBodies.map((body) => reframePhysicsBody({ worldFrame, body, fromFrame: frameA, toFrame: rebased }));
  const rebasedFinal = movedBodies.map((body) => integratePhysicsBody({ body, physicsFrame: rebased, dtSeconds: 2 }));
  const rebasedSnapshot = serializeSimulationSpatialSnapshot({ worldFrame, tick: 120, bodies: rebasedFinal, physicsFrame: rebased });
  assert.equal(rebasedSnapshot, fixedSnapshot);
}

// 7. Snapshot/replay can resume under a different physics-local anchor with identical world result.
{
  const body0 = worldEntityToPhysicsBody({ worldFrame, entity: moving, physicsFrame: frameA });
  const body1 = integratePhysicsBody({ body: body0, physicsFrame: frameA, dtSeconds: 3 });
  const serialized = serializeSimulationSpatialSnapshot({ worldFrame, tick: 180, bodies: [body1], physicsFrame: frameA });
  const restored = deserializeSimulationSpatialSnapshot(serialized);
  const replayFrame = createPhysicsSpatialFrame({
    physicsFrameId: 'physics-main',
    worldFrame: restored.worldFrame,
    epoch: 77,
    anchorWorld: createWorldPosition(restored.worldFrame, { easting: 608000, northing: 6649000, height: 150 }),
  });
  let replayBody = worldEntityToPhysicsBody({ worldFrame: restored.worldFrame, entity: restored.entities[0], physicsFrame: replayFrame });
  replayBody = integratePhysicsBody({ body: replayBody, physicsFrame: replayFrame, dtSeconds: 2 });
  const replayWorld = physicsBodyToWorldEntity({ worldFrame: restored.worldFrame, body: replayBody, physicsFrame: replayFrame });

  const directBody = integratePhysicsBody({ body: body1, physicsFrame: frameA, dtSeconds: 2 });
  const directWorld = physicsBodyToWorldEntity({ worldFrame, body: directBody, physicsFrame: frameA });
  assert.ok(distance(replayWorld, directWorld) < 1e-9);
  assert.deepEqual(replayWorld.velocity, directWorld.velocity);
}

// 8. A foreign world frame cannot be smuggled through the physics adapter.
{
  const otherFrame = createWorldFrame({ id: 'other-world', horizontalCrs: 'EPSG:25833', verticalDatum: 'NN2000' });
  const foreign = {
    id: 'foreign',
    position: createWorldPosition(otherFrame, { easting: 1, northing: 2, height: 3 }),
    velocity: { east: 0, north: 0, up: 0 },
  };
  assert.throws(() => worldEntityToPhysicsBody({ worldFrame, entity: foreign, physicsFrame: frameA }));
}

console.log(JSON.stringify({ status: 'PASS', contract: 'nwe.simulation-spatial-snapshot/0.1-candidate', cases: 8, physicsPrecisionPolicy: 'OPEN', renderOriginAuthority: false, physicsLocalAuthority: false }));
