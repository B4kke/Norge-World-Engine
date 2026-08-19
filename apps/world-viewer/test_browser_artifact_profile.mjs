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
const ticks = [0, 4, 4, 5, 10, 16, 16, 18];
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
assert.equal(profile.status, 'PASS');
assert.equal(profile.replay_only, true);
assert.equal(profile.network_fetch_included, false);
assert.equal(profile.artifact_role, 'road-network');
assert.equal(profile.iterations, 2);
assert.deepEqual(profile.samples, [
  { iteration: 1, verification_ms: 4, decode_ms: 1, total_ms: 5 },
  { iteration: 2, verification_ms: 6, decode_ms: 2, total_ms: 8 },
]);
assert.equal(profile.verification_ms.p50_ms, 5);
assert.equal(profile.decode_ms.p50_ms, 1.5);
assert.equal(profile.verification_plus_decode_ms.largest_ms, 8);

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
