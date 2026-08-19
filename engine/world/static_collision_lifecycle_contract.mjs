const SCHEMA = 'nwe.static-collision-lifecycle-event/0.1-candidate';
const PHASE = 'after-frame-maintenance-before-physics-step';

export class StaticCollisionLifecycleError extends Error {
  constructor(code, message) { super(message); this.name='StaticCollisionLifecycleError'; this.code=code; }
}
const fail=(c,m)=>{throw new StaticCollisionLifecycleError(c,m)};
const nonEmpty=(v,l)=>{if(typeof v!=='string'||!v.trim()) fail('INVALID_IDENTITY',`${l} must be non-empty`); return v};
const sha=(v,l='artifactSha256')=>{if(typeof v!=='string'||!/^[0-9a-f]{64}$/u.test(v)) fail('INVALID_ARTIFACT_SHA256',`${l} must be lowercase SHA-256`); return v};
const epoch=(v)=>{if(!Number.isSafeInteger(v)||v<0) fail('INVALID_EPOCH','physics epoch must be non-negative safe integer'); return v};
function exactKeys(v, allowed, label){
  if(!v||typeof v!=='object'||Array.isArray(v)) fail('INVALID_OBJECT',`${label} must be object`);
  const extras=Object.keys(v).filter(k=>!allowed.includes(k)); if(extras.length) fail('UNEXPECTED_FIELD',`${label} contains unsupported field(s): ${extras.join(', ')}`);
}
function ids(values){
  if(!Array.isArray(values)) fail('INVALID_DEPENDENCIES','dependentEntityIds must be an array');
  const out=values.map((v,i)=>nonEmpty(v,`dependentEntityIds[${i}]`));
  if(new Set(out).size!==out.length) fail('DUPLICATE_DEPENDENCY','dependentEntityIds must be unique');
  return Object.freeze([...out].sort());
}
export function createStaticCollisionLifecycleState({worldFrameId, physicsFrameId, physicsEpoch, collisions=[]}){
  nonEmpty(worldFrameId,'worldFrameId'); nonEmpty(physicsFrameId,'physicsFrameId'); epoch(physicsEpoch);
  if(!Array.isArray(collisions)) fail('INVALID_STATE','collisions must be an array');
  const seen=new Set();
  const normalized=collisions.map(c=>{
    exactKeys(c,['collisionId','tileId','artifactSha256','dependentEntityIds'],'collision state');
    const collisionId=nonEmpty(c.collisionId,'collisionId');
    if(seen.has(collisionId)) fail('DUPLICATE_COLLISION','collisionId must be unique'); seen.add(collisionId);
    return Object.freeze({collisionId,tileId:nonEmpty(c.tileId,'tileId'),artifactSha256:sha(c.artifactSha256),dependentEntityIds:ids(c.dependentEntityIds)});
  }).sort((a,b)=>a.collisionId.localeCompare(b.collisionId));
  return Object.freeze({worldFrameId,physicsFrameId,physicsEpoch,collisions:Object.freeze(normalized)});
}
export function createStaticCollisionLifecycleEvent(input){
  exactKeys(input,['schema','phase','tick','action','collisionId','tileId','artifactSha256','previousArtifactSha256','worldFrameId','physicsFrame','dependentEntityIds','continuity'],'event');
  if(input.schema!==SCHEMA) fail('UNSUPPORTED_SCHEMA',`schema must be ${SCHEMA}`);
  if(input.phase!==PHASE) fail('INVALID_PHASE',`phase must be ${PHASE}`);
  if(!Number.isSafeInteger(input.tick)||input.tick<0) fail('INVALID_TICK','tick must be non-negative safe integer');
  if(!['ACTIVATE','EVICT','REPLACE','SET_DEPENDENCIES'].includes(input.action)) fail('INVALID_ACTION','unsupported lifecycle action');
  const previous=input.previousArtifactSha256==null?null:sha(input.previousArtifactSha256,'previousArtifactSha256');
  const continuity=input.continuity??'none';
  if(!['none','atomic-rebind'].includes(continuity)) fail('INVALID_CONTINUITY','unsupported continuity mode');
  return Object.freeze({
    schema:SCHEMA,phase:PHASE,tick:input.tick,action:input.action,
    collisionId:nonEmpty(input.collisionId,'collisionId'),tileId:nonEmpty(input.tileId,'tileId'),
    artifactSha256:sha(input.artifactSha256),previousArtifactSha256:previous,
    worldFrameId:nonEmpty(input.worldFrameId,'worldFrameId'),
    physicsFrame:Object.freeze({physicsFrameId:nonEmpty(input.physicsFrame?.physicsFrameId,'physicsFrame.physicsFrameId'),epoch:epoch(input.physicsFrame?.epoch)}),
    dependentEntityIds:ids(input.dependentEntityIds),continuity
  });
}
export function applyStaticCollisionLifecycleEvent({state,event,currentPhysicsFrame}){
  const e=createStaticCollisionLifecycleEvent(event);
  if(state.worldFrameId!==e.worldFrameId) fail('WORLD_FRAME_MISMATCH','event belongs to another world frame');
  if(state.physicsFrameId!==e.physicsFrame.physicsFrameId||currentPhysicsFrame?.physicsFrameId!==e.physicsFrame.physicsFrameId) fail('PHYSICS_FRAME_MISMATCH','event belongs to another physics frame');
  if(state.physicsEpoch!==e.physicsFrame.epoch||currentPhysicsFrame?.epoch!==e.physicsFrame.epoch) fail('PHYSICS_EPOCH_MISMATCH','event must target the current post-maintenance physics epoch');
  const map=new Map(state.collisions.map(c=>[c.collisionId,c]));
  const current=map.get(e.collisionId);
  if(e.action==='ACTIVATE'){
    if(current) fail('ALREADY_RESIDENT','collision is already resident');
    if(e.previousArtifactSha256!==null) fail('INVALID_PREVIOUS_ARTIFACT','ACTIVATE cannot name previous artifact');
    map.set(e.collisionId,Object.freeze({collisionId:e.collisionId,tileId:e.tileId,artifactSha256:e.artifactSha256,dependentEntityIds:e.dependentEntityIds}));
  } else {
    if(!current) fail('NOT_RESIDENT','collision is not resident');
    if(current.tileId!==e.tileId) fail('TILE_ID_MISMATCH','event tile does not match resident collision');
    if(current.artifactSha256!==e.artifactSha256 && e.action!=='REPLACE') fail('ARTIFACT_MISMATCH','event artifact does not match resident collision');
    if(e.action==='EVICT'){
      if(current.dependentEntityIds.length) fail('COLLISION_IN_USE','cannot evict collision required by active simulation entities');
      if(e.dependentEntityIds.length) fail('INVALID_DEPENDENCIES','EVICT dependency precondition must be empty');
      map.delete(e.collisionId);
    } else if(e.action==='REPLACE'){
      if(e.previousArtifactSha256!==current.artifactSha256) fail('PREVIOUS_ARTIFACT_MISMATCH','replacement must name exact resident artifact');
      if(e.artifactSha256===current.artifactSha256) fail('NOOP_REPLACEMENT','replacement artifact must change');
      if(current.dependentEntityIds.length && e.continuity!=='atomic-rebind') fail('CONTINUITY_REQUIRED','in-use replacement requires atomic-rebind continuity');
      map.set(e.collisionId,Object.freeze({collisionId:e.collisionId,tileId:e.tileId,artifactSha256:e.artifactSha256,dependentEntityIds:e.dependentEntityIds}));
    } else if(e.action==='SET_DEPENDENCIES'){
      if(e.artifactSha256!==current.artifactSha256) fail('ARTIFACT_MISMATCH','dependency update must target exact resident artifact');
      if(e.previousArtifactSha256!==null) fail('INVALID_PREVIOUS_ARTIFACT','dependency update cannot name previous artifact');
      map.set(e.collisionId,Object.freeze({...current,dependentEntityIds:e.dependentEntityIds}));
    }
  }
  return createStaticCollisionLifecycleState({worldFrameId:state.worldFrameId,physicsFrameId:state.physicsFrameId,physicsEpoch:state.physicsEpoch,collisions:[...map.values()]});
}
export const STATIC_COLLISION_LIFECYCLE_SCHEMA=SCHEMA;
export const STATIC_COLLISION_LIFECYCLE_PHASE=PHASE;
