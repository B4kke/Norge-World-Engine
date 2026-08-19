import RAPIER from '@dimforge/rapier3d-compat';
import { createWorldFrame } from '../../engine/world/world_contract.mjs';
import { createPhysicsSpatialFrame } from '../../engine/world/physics_state_contract.mjs';
import { createPhysicsFrameMaintenanceEvent } from '../../engine/world/physics_frame_event_contract.mjs';
import { createStaticCollisionLifecycleState } from '../../engine/world/static_collision_lifecycle_contract.mjs';
import { planStaticCollisionEpochRebind } from '../../engine/world/static_collision_epoch_rebind_contract.mjs';

await RAPIER.init();
const WORLD=createWorldFrame({id:'world:nannestad:rebind-probe',horizontalCrs:'EPSG:25832',verticalDatum:'NN2000'});
const OLD='a'.repeat(64), NEW='b'.repeat(64), ENTITY='entity:body';
const frame0=createPhysicsSpatialFrame({physicsFrameId:'physics:tile-crossing',worldFrame:WORLD,epoch:0,anchorWorld:{worldFrameId:WORLD.id,easting:500000,northing:6650000,height:0}});
const frame1=createPhysicsSpatialFrame({physicsFrameId:'physics:tile-crossing',worldFrame:WORLD,epoch:1,anchorWorld:{worldFrameId:WORLD.id,easting:501000,northing:6649250,height:0}});
const maintenance=createPhysicsFrameMaintenanceEvent({tick:30,worldFrame:WORLD,fromFrame:frame0,toFrame:frame1});
let lifecycle=createStaticCollisionLifecycleState({worldFrameId:WORLD.id,physicsFrameId:frame0.physicsFrameId,physicsEpoch:0,collisions:[{collisionId:'terrain:a',tileId:'tile:a',artifactSha256:OLD,dependentEntityIds:[ENTITY]}]});
const transaction={schema:'nwe.static-collision-epoch-rebind/0.1-candidate',tick:30,worldFrameId:WORLD.id,maintenanceEvent:maintenance,replacement:{collisionId:'terrain:a',tileId:'tile:a',previousArtifactSha256:OLD,artifactSha256:NEW,dependentEntityIds:[ENTITY],continuity:'atomic-rebind'}};

const world=new RAPIER.World({x:0,y:-9.81,z:0}); world.timestep=1/60;
const floor=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,0,0));
let floorCollider=world.createCollider(RAPIER.ColliderDesc.cuboid(5,0.25,2).setFriction(0),floor);
const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-2,0.7,0).setLinvel(1,0,0).setCanSleep(false));
world.createCollider(RAPIER.ColliderDesc.ball(0.45).setFriction(0).setRestitution(0),body);
for(let tick=0;tick<30;tick+=1) world.step();
const before={...body.translation()};
const bad=structuredClone(transaction); bad.replacement.previousArtifactSha256='c'.repeat(64);
let rejectedCode=null; try{planStaticCollisionEpochRebind({worldFrame:WORLD,currentPhysicsFrame:frame0,lifecycleState:lifecycle,transaction:bad});}catch(error){rejectedCode=error?.code;}
if(rejectedCode!=='PREVIOUS_ARTIFACT_MISMATCH') throw new Error(`adversarial replacement was not rejected: ${rejectedCode}`);
const afterRejected={...body.translation()};
if(JSON.stringify(before)!==JSON.stringify(afterRejected)) throw new Error('solver mutated before failed preflight completed');

const plan=planStaticCollisionEpochRebind({worldFrame:WORLD,currentPhysicsFrame:frame0,lifecycleState:lifecycle,transaction});
const d=plan.solverLocalTranslation;
const bp=body.translation(); body.setTranslation({x:bp.x+d.x,y:bp.y+d.y,z:bp.z+d.z},true);
const fp=floor.translation(); floor.setTranslation({x:fp.x+d.x,y:fp.y+d.y,z:fp.z+d.z},false);
world.removeCollider(floorCollider,false);
floorCollider=world.createCollider(RAPIER.ColliderDesc.cuboid(5,0.25,2).setFriction(0),floor);
lifecycle=plan.nextLifecycleState;
for(let tick=31;tick<91;tick+=1) world.step();
const finalLocal=body.translation();
const finalWorld={easting:plan.nextPhysicsFrame.anchorWorld.easting+finalLocal.x,northing:plan.nextPhysicsFrame.anchorWorld.northing+finalLocal.z,height:plan.nextPhysicsFrame.anchorWorld.height+finalLocal.y};
if(lifecycle.physicsEpoch!==1||lifecycle.collisions[0].artifactSha256!==NEW) throw new Error('post-rebind lifecycle identity mismatch');
if(!Number.isFinite(finalWorld.easting)||finalWorld.height < -10) throw new Error('solver continuity failed after accepted rebind');
console.log(JSON.stringify({schema:'nwe.atlas-rapier-epoch-artifact-rebind-proof/0.1',backend:'@dimforge/rapier3d-compat@0.19.3',rejectedCode,preflightSolverUnchanged:true,maintenanceDeltaWorld:maintenance.deltaWorld,solverLocalTranslation:d,postEpoch:lifecycle.physicsEpoch,postArtifactSha256:lifecycle.collisions[0].artifactSha256,dependencyPreserved:lifecycle.collisions[0].dependentEntityIds.includes(ENTITY),finalWorld},null,2));
world.free();
