import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { classifyCompilerEnvelope, validateRuntimeArtifact, RUNTIME_DECISION } from './vektor_runtime_gate_v03.mjs';

const bytes = new TextEncoder().encode('compiled-terrain-fixture-v03');
const sha = createHash('sha256').update(bytes).digest('hex');
const base = {
  status: 'REAL_COMPILED',
  canonical_crs: 'EPSG:25832',
  canonical_vertical_datum: 'NN2000',
  artifact_ref: {
    artifact_role: 'terrain', tile_id: 'epsg25832_611000_6677000_1000m',
    reference: 'artifacts/terrain/epsg25832_611000_6677000_1000m.bin',
    sha256: sha, byte_size: bytes.byteLength, schema_or_media_type: 'application/vnd.nwe.terrain+bin;v=0.1',
    lineage_hash: 'lineage-abc'
  },
  promotion_record: {
    to_state: 'REAL_COMPILED', lineage_hash: 'lineage-abc',
    gates: {
      source_validated:'PASS', transform_validated:'PASS', normalized_bytes_verified:'PASS',
      compiler_identity_bound:'PASS', artifact_bytes_verified:'PASS', lineage_reconstructed:'PASS',
      determinism_policy_satisfied:'PASS'
    }
  }
};

assert.equal(classifyCompilerEnvelope({status:'FAILED', error:{code:'UNRESOLVED_SPATIAL_INDEX'}}).decision, RUNTIME_DECISION.SOURCE_BLOCKED);
assert.equal(classifyCompilerEnvelope({status:'NORMALIZED'}).decision, RUNTIME_DECISION.NOT_READY);
assert.equal(validateRuntimeArtifact(base, bytes).decision, RUNTIME_DECISION.READY);
assert.equal(validateRuntimeArtifact({...base, status:'CONTRACT_FIXTURE_ONLY'}, bytes).decision, RUNTIME_DECISION.NOT_READY);
assert.equal(validateRuntimeArtifact({...base, artifact_ref:{...base.artifact_ref, reference:'https://nedlasting.geonorge.no/raw.tif'}}, bytes).code, 'RAW_SOURCE_REFERENCE_FORBIDDEN');
assert.equal(validateRuntimeArtifact({...base, promotion_record:{...base.promotion_record, lineage_hash:'other'}}, bytes).code, 'LINEAGE_HASH_MISMATCH');
assert.equal(validateRuntimeArtifact({...base, promotion_record:{...base.promotion_record, gates:{...base.promotion_record.gates, source_validated:'FAIL'}}}, bytes).code, 'PROMOTION_GATE_NOT_PASS');
assert.equal(validateRuntimeArtifact(base, new Uint8Array([1,2,3])).code, 'BYTE_SIZE_MISMATCH');

const cases = [
  {name:'source unresolved', input:{status:'FAILED',error:{code:'UNRESOLVED_SPATIAL_INDEX'}}, expected:'SOURCE_BLOCKED'},
  {name:'validated source', input:{status:'VALIDATED_SOURCE'}, expected:'NOT_RUNTIME_READY'},
  {name:'normalized', input:{status:'NORMALIZED'}, expected:'NOT_RUNTIME_READY'},
  {name:'ready', input:base, bytes, expected:'READY_FOR_RUNTIME'},
];
for (const c of cases) {
  const r = c.bytes ? validateRuntimeArtifact(c.input,c.bytes) : classifyCompilerEnvelope(c.input);
  assert.equal(r.decision,c.expected,c.name);
}

const N=100000;
const samples=[];
for(let run=0;run<5;run++){
  const t0=performance.now();
  for(let i=0;i<N;i++) classifyCompilerEnvelope({status:'FAILED',error:{code:'UNRESOLVED_SPATIAL_INDEX'}});
  samples.push(performance.now()-t0);
}
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({status:'PASS', tests:8, source_block_classification_100k_ms:samples, median_100k_ms:samples[2], median_per_call_us:(samples[2]*1000/N)}, null, 2));
