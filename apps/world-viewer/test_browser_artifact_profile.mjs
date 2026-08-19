import assert from 'node:assert/strict';
import { normalizeProfileIterations, profileVerifiedJsonArtifact } from './src/browserArtifactProfile.mjs';

assert.equal(normalizeProfileIterations(1), 1);
assert.equal(normalizeProfileIterations('5'), 5);
assert.throws(() => normalizeProfileIterations(0), /iterations must be an integer/);
assert.throws(() => normalizeProfileIterations(21), /iterations must be an integer/);
assert.throws(() => normalizeProfileIterations(1.5), /iterations must be an integer/);

const bundle = {
  artifact_ref: {
    artifact_role: 'road-network',
    sha256: 'abc123',
  },
};
const bytes = new TextEncoder().encode(JSON.stringify({ schema: 'fixture', paths: [] }));
const ticks = [0, 4, 4, 5, 5, 7, 10, 16, 16, 18, 18, 21];
let tickIndex = 0;
let verifyCalls = 0;
const profile = await profileVerifiedJsonArtifact({
  bundle,
  bytes,
  iterations: 2,
  now: () => ticks[tickIndex++],
  verifyImpl: async (_bundle, candidateBytes) => {
    verifyCalls += 1;
    assert.equal(candidateBytes, bytes);
    return { ok: true, decision: 'READY_FOR_RUNTIME', code: 'RUNTIME_VERIFICATION_PASS' };
  },
});

assert.equal(verifyCalls, 2);
assert.equal(profile.schema, 'nwe.browser-artifact-profile/0.2');
assert.equal(profile.status, 'PASS');
assert.equal(profile.replay_only, true);
assert.equal(profile.network_fetch_included, false);
assert.equal(profile.artifact_role, 'road-network');
assert.equal(profile.iterations, 2);
assert.deepEqual(profile.samples, [
  { iteration: 1, verification_ms: 4, utf8_decode_ms: 1, json_parse_ms: 2, decode_ms: 3, total_ms: 7 },
  { iteration: 2, verification_ms: 6, utf8_decode_ms: 2, json_parse_ms: 3, decode_ms: 5, total_ms: 11 },
]);
assert.deepEqual(profile.first_replay, {
  verification_ms: 4,
  utf8_decode_ms: 1,
  json_parse_ms: 2,
  decode_ms: 3,
  total_ms: 7,
});
assert.equal(profile.steady_state.iterations, 1);
assert.equal(profile.steady_state.verification_ms.p50_ms, 6);
assert.equal(profile.steady_state.utf8_decode_ms.p50_ms, 2);
assert.equal(profile.steady_state.json_parse_ms.p50_ms, 3);
assert.equal(profile.steady_state.decode_ms.p50_ms, 5);
assert.equal(profile.steady_state.verification_plus_decode_ms.largest_ms, 11);
assert.equal(profile.verification_ms.p50_ms, 5);
assert.equal(profile.utf8_decode_ms.p50_ms, 1.5);
assert.equal(profile.json_parse_ms.p50_ms, 2.5);
assert.equal(profile.decode_ms.p50_ms, 4);
assert.equal(profile.verification_plus_decode_ms.largest_ms, 11);

let singleTick = 0;
const single = await profileVerifiedJsonArtifact({
  bundle,
  bytes,
  iterations: 1,
  now: () => [0, 3, 3, 4, 4, 6][singleTick++],
  verifyImpl: async () => ({ ok: true, decision: 'READY_FOR_RUNTIME', code: 'RUNTIME_VERIFICATION_PASS' }),
});
assert.deepEqual(single.first_replay, {
  verification_ms: 3,
  utf8_decode_ms: 1,
  json_parse_ms: 2,
  decode_ms: 3,
  total_ms: 6,
});
assert.equal(single.steady_state, null);

await assert.rejects(
  profileVerifiedJsonArtifact({
    bundle,
    bytes,
    iterations: 1,
    verifyImpl: async () => ({ ok: false, decision: 'REJECTED', code: 'ARTIFACT_SHA256_MISMATCH' }),
  }),
  /PROFILE_RUNTIME_VERIFICATION_REJECTED: ARTIFACT_SHA256_MISMATCH \/ REJECTED/,
);

await assert.rejects(
  profileVerifiedJsonArtifact({
    bundle,
    bytes: new TextEncoder().encode('{'),
    iterations: 1,
    verifyImpl: async () => ({ ok: true, decision: 'READY_FOR_RUNTIME', code: 'RUNTIME_VERIFICATION_PASS' }),
  }),
  SyntaxError,
);

console.log('browser artifact profile regressions: PASS');
