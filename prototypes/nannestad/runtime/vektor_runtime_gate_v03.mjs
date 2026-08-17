import { createHash } from 'node:crypto';

export const RUNTIME_DECISION = Object.freeze({
  READY: 'READY_FOR_RUNTIME',
  SOURCE_BLOCKED: 'SOURCE_BLOCKED',
  NOT_READY: 'NOT_RUNTIME_READY',
  REJECTED: 'REJECTED',
});

const SOURCE_BLOCK_CODES = new Set([
  'UNRESOLVED_SPATIAL_INDEX',
  'SOURCE_FETCH_FAILED',
  'SOURCE_VALIDATION_FAILED',
  'RASTER_METADATA_INVALID',
]);

const PRE_RUNTIME_STATES = new Set([
  'CONTRACT_FIXTURE_ONLY',
  'VALIDATED_SOURCE',
  'NORMALIZED',
]);

const RAW_SOURCE_HOST_MARKERS = [
  'geonorge', 'kartverket', 'vegvesen', 'nvdb', 'overpass', 'openstreetmap',
];

function fail(decision, code, detail, stage = 'runtime_gate') {
  return { ok: false, decision, code, stage, detail };
}

function isRawSourceReference(reference) {
  if (typeof reference !== 'string') return false;
  const lower = reference.toLowerCase();
  return /^https?:\/\//.test(lower) && RAW_SOURCE_HOST_MARKERS.some(x => lower.includes(x));
}

export function classifyCompilerEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return fail(RUNTIME_DECISION.REJECTED, 'INVALID_ENVELOPE', 'compiler envelope missing');
  }

  const status = envelope.status ?? envelope.artifact_status ?? null;
  const errorCode = envelope.error?.code ?? envelope.error_code ?? null;

  if (errorCode && SOURCE_BLOCK_CODES.has(errorCode)) {
    return fail(RUNTIME_DECISION.SOURCE_BLOCKED, errorCode,
      envelope.error?.detail ?? envelope.detail ?? 'compiler/source stage blocked',
      'compiler_source');
  }

  if (status === 'FAILED') {
    return fail(RUNTIME_DECISION.SOURCE_BLOCKED, errorCode ?? 'COMPILER_FAILED',
      envelope.error?.detail ?? 'compiler failed before runtime-ready artifact',
      envelope.stage ?? 'compiler');
  }

  if (PRE_RUNTIME_STATES.has(status)) {
    return fail(RUNTIME_DECISION.NOT_READY, `STATE_${status}`,
      `${status} is not a runtime-loadable geographic artifact`,
      'compiler_promotion');
  }

  if (status !== 'REAL_COMPILED') {
    return fail(RUNTIME_DECISION.REJECTED, 'UNKNOWN_PROMOTION_STATE',
      `unknown or missing promotion state: ${String(status)}`,
      'compiler_promotion');
  }

  return { ok: true, decision: RUNTIME_DECISION.READY, code: 'PROMOTION_STATE_OK', stage: 'runtime_gate' };
}

export function validateRuntimeArtifact(envelope, bytes) {
  const classification = classifyCompilerEnvelope(envelope);
  if (!classification.ok) return classification;

  const a = envelope.artifact_ref ?? envelope.artifact ?? envelope;
  const p = envelope.promotion_record ?? null;
  const required = ['artifact_role','tile_id','reference','sha256','byte_size','schema_or_media_type','lineage_hash'];
  const missing = required.filter(k => a?.[k] === undefined || a?.[k] === null || a?.[k] === '');
  if (missing.length) return fail(RUNTIME_DECISION.REJECTED, 'ARTIFACT_REF_INCOMPLETE', missing.join(','));

  if (isRawSourceReference(a.reference)) {
    return fail(RUNTIME_DECISION.REJECTED, 'RAW_SOURCE_REFERENCE_FORBIDDEN', a.reference);
  }

  if (!p || p.to_state !== 'REAL_COMPILED') {
    return fail(RUNTIME_DECISION.REJECTED, 'PROMOTION_RECORD_MISSING_OR_INVALID', 'REAL_COMPILED requires PromotionRecord');
  }
  if (p.lineage_hash !== a.lineage_hash) {
    return fail(RUNTIME_DECISION.REJECTED, 'LINEAGE_HASH_MISMATCH', 'promotion/artifact lineage mismatch');
  }

  const gates = p.gates ?? {};
  const requiredGates = [
    'source_validated','transform_validated','normalized_bytes_verified',
    'compiler_identity_bound','artifact_bytes_verified','lineage_reconstructed',
    'determinism_policy_satisfied'
  ];
  const failedGates = requiredGates.filter(k => gates[k] !== 'PASS');
  if (failedGates.length) {
    return fail(RUNTIME_DECISION.REJECTED, 'PROMOTION_GATE_NOT_PASS', failedGates.join(','));
  }

  if (!(bytes instanceof Uint8Array)) {
    return fail(RUNTIME_DECISION.REJECTED, 'ARTIFACT_BYTES_MISSING', 'bytes must be Uint8Array');
  }
  if (bytes.byteLength !== a.byte_size) {
    return fail(RUNTIME_DECISION.REJECTED, 'BYTE_SIZE_MISMATCH', `${bytes.byteLength} != ${a.byte_size}`);
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== a.sha256) {
    return fail(RUNTIME_DECISION.REJECTED, 'SHA256_MISMATCH', `${actual} != ${a.sha256}`);
  }

  if (a.artifact_role === 'terrain') {
    if (a.tile_id !== 'epsg25832_611000_6677000_1000m') {
      return fail(RUNTIME_DECISION.REJECTED, 'TILE_ID_MISMATCH', a.tile_id);
    }
    if (envelope.canonical_crs !== 'EPSG:25832' || envelope.canonical_vertical_datum !== 'NN2000') {
      return fail(RUNTIME_DECISION.REJECTED, 'TERRAIN_REFERENCE_FRAME_MISMATCH',
        `${envelope.canonical_crs}/${envelope.canonical_vertical_datum}`);
    }
  }

  return {
    ok: true,
    decision: RUNTIME_DECISION.READY,
    code: 'RUNTIME_ARTIFACT_VERIFIED',
    stage: 'runtime_gate',
    artifact_role: a.artifact_role,
    byte_size: a.byte_size,
    sha256: actual,
    next: ['decode','local_origin_rebase','gpu_upload'],
  };
}
