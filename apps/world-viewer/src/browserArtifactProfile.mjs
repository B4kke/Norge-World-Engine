import { verifyRuntimeBundleWeb } from '../../../engine/streaming/runtime_verifier_web.mjs';
import { monotonicNow, summarizeFrameGaps } from './rendererObservability.mjs';

const PROFILE_SCHEMA = 'nwe.browser-artifact-profile/0.2';

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

function assertMeasuredDuration(phase, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`PROFILE_INVALID_TIMING: ${phase}`);
  }
  return value;
}

function summarizeSamples(samples) {
  if (!samples.length) return null;
  return {
    iterations: samples.length,
    verification_ms: summarizeFrameGaps(samples.map((sample) => sample.verification_ms)),
    utf8_decode_ms: summarizeFrameGaps(samples.map((sample) => sample.utf8_decode_ms)),
    json_parse_ms: summarizeFrameGaps(samples.map((sample) => sample.json_parse_ms)),
    decode_ms: summarizeFrameGaps(samples.map((sample) => sample.decode_ms)),
    verification_plus_decode_ms: summarizeFrameGaps(samples.map((sample) => sample.total_ms)),
  };
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
    const verifyMs = assertMeasuredDuration('verification', now() - verifyStartedAt);
    assertRuntimeVerificationPass(verification);

    const utf8StartedAt = now();
    const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const utf8DecodeMs = assertMeasuredDuration('utf8_decode', now() - utf8StartedAt);

    const parseStartedAt = now();
    const artifact = JSON.parse(jsonText);
    const jsonParseMs = assertMeasuredDuration('json_parse', now() - parseStartedAt);
    if (!artifact || typeof artifact !== 'object') throw new Error('PROFILE_ARTIFACT_JSON_NOT_OBJECT');

    const decodeMs = utf8DecodeMs + jsonParseMs;
    samples.push({
      iteration: index + 1,
      verification_ms: verifyMs,
      utf8_decode_ms: utf8DecodeMs,
      json_parse_ms: jsonParseMs,
      decode_ms: decodeMs,
      total_ms: verifyMs + decodeMs,
    });
  }

  const firstReplay = samples[0];
  const steadyStateSamples = samples.slice(1);
  const overall = summarizeSamples(samples);

  return {
    schema: PROFILE_SCHEMA,
    status: 'PASS',
    replay_only: true,
    network_fetch_included: false,
    artifact_role: bundle.artifact_ref.artifact_role ?? null,
    artifact_sha256: bundle.artifact_ref.sha256 ?? null,
    artifact_bytes: bytes.byteLength,
    iterations: count,
    verification_ms: overall.verification_ms,
    utf8_decode_ms: overall.utf8_decode_ms,
    json_parse_ms: overall.json_parse_ms,
    decode_ms: overall.decode_ms,
    verification_plus_decode_ms: overall.verification_plus_decode_ms,
    first_replay: {
      verification_ms: firstReplay.verification_ms,
      utf8_decode_ms: firstReplay.utf8_decode_ms,
      json_parse_ms: firstReplay.json_parse_ms,
      decode_ms: firstReplay.decode_ms,
      total_ms: firstReplay.total_ms,
    },
    steady_state: summarizeSamples(steadyStateSamples),
    samples,
    note: 'Replays the shared full RuntimeVerificationBundle verifier against already-fetched compiled artifact bytes, then times strict UTF-8 decoding and JSON.parse separately. First replay is reported separately from later steady-state samples so warm-up/JIT effects are not silently folded into cache/worker decisions. Invalid/non-monotonic phase timing fails closed rather than being filtered out of summaries. It never replaces the production verification path and excludes network time.',
  };
}
