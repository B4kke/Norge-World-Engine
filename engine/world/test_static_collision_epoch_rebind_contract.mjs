import assert from 'node:assert/strict';
import { createPhysicsSpatialFrame } from './physics_state_contract.mjs';
import { createPhysicsFrameMaintenanceEvent } from './physics_frame_event_contract.mjs';
import { createStaticCollisionLifecycleState } from './static_collision_lifecycle_contract.mjs';
import { planStaticCollisionEpochRebind } from './static_collision_epoch_rebind_contract.mjs';

const WORLD = Object.freeze({ id:'world:test', horizontalCrs:'EPSG:25832', horizontalUnit:'metre', verticalDatum:'NN2000', verticalUnit:'metre' });
const frame0 = createPhysicsSpatialFrame({ physicsFrameId:'physics:test', worldFrame:WORLD, epoch:0, anchorWorld:{worldFrameId:WORLD.id,easting:500000,northing:6650000,height:100} });
const frame1 = createPhysicsSpatialFrame({ physicsFrameId:'physics:test', worldFrame:WORLD, epoch:1, anchorWorld:{worldFrameId:WORLD.id,easting:501000,northing:6649250,height:100} });
const maintenance = createPhysicsFrameMaintenanceEvent({ tick:42, worldFrame:WORLD, fromFrame:frame0, toFrame:frame1 });
const OLD='a'.repeat(64), NEW='b'.repeat(64);
const state = createStaticCollisionLifecycleState({ worldFrameId:WORLD.id, physicsFrameId:frame0.physicsFrameId, physicsEpoch:0, collisions:[{ collisionId:'collision:a', tileId:'tile:a', artifactSha256:OLD, dependentEntityIds:['entity:1'] }] });
const tx = () => ({ schema:'nwe.static-collision-epoch-rebind/0.1-candidate', tick:42, worldFrameId:WORLD.id, maintenanceEvent:maintenance, replacement:{ collisionId:'collision:a', tileId:'tile:a', previousArtifactSha256:OLD, artifactSha256:NEW, dependentEntityIds:['entity:1'], continuity:'atomic-rebind' } });
function expectCode(code, mutate) { const value=structuredClone(tx()); mutate(value); assert.throws(()=>planStaticCollisionEpochRebind({worldFrame:WORLD,currentPhysicsFrame:frame0,lifecycleState:state,transaction:value}),(error)=>error?.code===code); }

const planned = planStaticCollisionEpochRebind({ worldFrame:WORLD, currentPhysicsFrame:frame0, lifecycleState:state, transaction:tx() });
assert.equal(planned.nextPhysicsFrame.epoch,1);
assert.deepEqual(planned.solverLocalTranslation,{x:-1000,y:0,z:750});
assert.equal(planned.nextLifecycleState.physicsEpoch,1);
assert.equal(planned.nextLifecycleState.collisions[0].artifactSha256,NEW);
assert.deepEqual(planned.nextLifecycleState.collisions[0].dependentEntityIds,['entity:1']);
expectCode('CONTINUITY_REQUIRED',(v)=>{v.replacement.continuity='none';});
expectCode('PREVIOUS_ARTIFACT_MISMATCH',(v)=>{v.replacement.previousArtifactSha256='c'.repeat(64);});
expectCode('OCCUPANCY_CONTINUITY_MISMATCH',(v)=>{v.replacement.dependentEntityIds=[];});
expectCode('TICK_MISMATCH',(v)=>{v.tick=43;});
expectCode('WORLD_FRAME_MISMATCH',(v)=>{v.worldFrameId='world:foreign';});
expectCode('UNEXPECTED_FIELD',(v)=>{v.renderOrigin={e:1,n:2};});
assert.throws(()=>planStaticCollisionEpochRebind({worldFrame:WORLD,currentPhysicsFrame:frame1,lifecycleState:state,transaction:tx()}),(error)=>['STALE_LIFECYCLE_FRAME','STALE_PHYSICS_EPOCH'].includes(error?.code));
console.log('static collision epoch rebind regressions: PASS (8 cases)');
