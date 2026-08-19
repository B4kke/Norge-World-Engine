import { verifyRuntimeBundleWeb } from '../../../engine/streaming/runtime_verifier_web.mjs';
import { monotonicNow, summarizeFrameGaps } from './rendererObservability.mjs';

const PROFILE_SCHEMA = 'nwe.browser-artifact-profile/0.1';

export function normalizeProfileIterations(value, { min = 1, max = 20 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`iterations must be an integer within [${min}, ${max}]`);
  }
  return parsed;
}

function assertRuntimeVerificationPass(result) {
  if (!result?.ok || result?.decision !== 'READY_FOR_RUNTIME' || result?.code !== 'RUNTIME_VERIFICATION_PASS') {
    throw new Error(`PROFILE_RUNTIME_VERIFICATION_REJECTED: ${result?.code ?? 'UNKNOWN'} / ${result?.decision ?? 'UNKNOWN'}`);
  }
}

function decodeUtf8Json(bytes) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function profileVerifiedJsonArtifact({
  bundle,
  bytes,
  iterations = 5,
  verifyImpl = verifyRuntimeBundleWeb,
  cryptoImpl = globalThis.crypto,
  now = monotonicNow,
} = {}) {
  const count = normalizeProfileIterations(iterations);
  if (!bundle?.artifact_ref) throw new TypeError('bundle.artifact_ref is required');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new TypeError('non-empty Uint8Array bytes are required');
  if (typeof verifyImpl !== 'function') throw new TypeError('verifyImpl is required');
  if (typeof now !== 'function') throw new TypeError('now is required');

  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const verifyStartedAt = now();
    const verification = await verifyImpl(bundle, bytes, { cryptoImpl });
    const verifyMs = now() - verifyStartedAt;
    assertRuntimeVerificationPass(verification);

    const decodeStartedAt = now();
    const artifact = decodeUtf8Json(bytes);
    const decodeMs = now() - decodeStartedAt;
    if (!artifact || typeof artifact !== 'object') throw new Error('PROFILE_ARTIFACT_JSON_NOT_OBJECT');

    samples.push({
      iteration: index + 1,
      verification_ms: verifyMs,
      decode_ms: decodeMs,
      total_ms: verifyMs + decodeMs,
    });
  }

  return {
    schema: PROFILE_SCHEMA,
    status: 'PASS',
    replay_only: true,
    network_fetch_included: false,
    artifact_role: bundle.artifact_ref.artifact_role ?? null,
    artifact_sha256: bundle.artifact_ref.sha256 ?? null,
    artifact_bytes: bytes.byteLength,
    iterations: count,
    verification_ms: summarizeFrameGaps(samples.map((sample) => sample.verification_ms)),
    decode_ms: summarizeFrameGaps(samples.map((sample) => sample.decode_ms)),
    verification_plus_decode_ms: summarizeFrameGaps(samples.map((sample) => sample.total_ms)),
    samples,
    note: 'Replays the shared full RuntimeVerificationBundle verifier and strict UTF-8 JSON decode against already-fetched compiled artifact bytes. It never replaces the production verification path and excludes network time.',
  };
}
