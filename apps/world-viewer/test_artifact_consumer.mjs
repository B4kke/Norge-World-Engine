import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";

import { canonicalSha256 } from "../../engine/schemas/js/src/canonical.mjs";
import { artifactIdentityPayload } from "../../engine/streaming/runtime_verifier.mjs";
import { loadCompiledJsonArtifact } from "./artifact_consumer.mjs";

const artifact = { schema: "nwe.road-network-artifact/0.1", tile_id: "tile", paths: [] };
const bytes = new TextEncoder().encode(JSON.stringify(artifact));
const sha = createHash("sha256").update(bytes).digest("hex");

function gates() {
  return {
    source_validated: "PASS",
    transform_validated: "PASS",
    normalized_bytes_verified: "PASS",
    compiler_identity_bound: "PASS",
    artifact_bytes_verified: "PASS",
    lineage_reconstructed: "PASS",
    determinism_policy_satisfied: "PASS",
  };
}

function buildBundle(reference = "cache://compiled/tile/road-network/hash.json") {
  const source = {
    schema: "nwe.source-snapshot/0.3",
    source_id: "fixture:roads",
    raw_sha256: "a".repeat(64),
    raw_byte_size: 123,
    source_crs: "EPSG:25833",
    source_vertical_datum: "NN2000",
    z_semantics: "normal_height_m",
  };
  const sourceHash = canonicalSha256(source);
  const transform = {
    schema: "nwe.transform-contract/0.1",
    source_snapshot_hash: sourceHash,
    operation: "fixture-road-normalization",
    horizontal_crs: "EPSG:25832",
    vertical_datum: "NN2000",
  };
  const transformHash = canonicalSha256(transform);
  const normalized = {
    schema: "nwe.normalized-snapshot/0.1",
    source_snapshot_hash: sourceHash,
    transform_contract_hash: transformHash,
    sha256: "b".repeat(64),
    byte_size: 456,
    media_type: "application/json",
  };
  const normalizedHash = canonicalSha256(normalized);
  const compilerConfig = {
    schema: "nwe.compiler-config/0.1",
    compiler_id: "nwe-world-compiler",
    compiler_version: "0.1.0",
    road_format: "fixture-json",
  };
  const compilerConfigHash = canonicalSha256(compilerConfig);
  const lineage = {
    schema: "nwe.compile-lineage/0.1",
    tile_id: "tile",
    artifact_role: "road-network",
    source_snapshot_hashes: [sourceHash],
    normalized_snapshot_hashes: [normalizedHash],
    compiler_config_hash: compilerConfigHash,
  };
  const lineageHash = canonicalSha256(lineage);
  const artifactRef = {
    schema: "nwe.artifact-ref/0.1",
    artifact_role: "road-network",
    tile_id: "tile",
    sha256: sha,
    byte_size: bytes.byteLength,
    media_type: "application/json",
    lineage_hash: lineageHash,
    artifact_status: "REAL_COMPILED",
    transport: { reference },
  };
  const artifactRefHash = canonicalSha256(artifactIdentityPayload(artifactRef));
  const promotion = {
    schema: "nwe.promotion-record/0.1",
    lineage_hash: lineageHash,
    artifact_ref_hash: artifactRefHash,
    from_state: "NORMALIZED",
    to_state: "REAL_COMPILED",
    gates: gates(),
  };
  return {
    bundle_schema: "nwe.runtime-verification-bundle/0.1",
    canonicalization_id: "urn:ietf:rfc:8785",
    hash_algorithm: "sha-256",
    source_snapshots: [source],
    source_snapshot_hashes: [sourceHash],
    transform_contracts: [transform],
    transform_contract_hashes: [transformHash],
    normalized_snapshots: [normalized],
    normalized_snapshot_hashes: [normalizedHash],
    compiler_config: compilerConfig,
    compiler_config_hash: compilerConfigHash,
    compile_lineage: lineage,
    lineage_hash: lineageHash,
    artifact_ref: artifactRef,
    artifact_ref_hash: artifactRefHash,
    promotion_record: promotion,
    promotion_record_hash: canonicalSha256(promotion),
  };
}

function fetchPair(bundle, artifactBytes = bytes, calls = []) {
  return async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return { ok: true, status: 200, json: async () => bundle };
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => artifactBytes.buffer.slice(
        artifactBytes.byteOffset,
        artifactBytes.byteOffset + artifactBytes.byteLength,
      ),
    };
  };
}

let cases = 0;

const bundle = buildBundle();
const calls = [];
const loaded = await loadCompiledJsonArtifact({
  bundleUrl: "https://viewer.example/runtime/roads.bundle.json",
  fetchImpl: fetchPair(bundle, bytes, calls),
  cryptoImpl: webcrypto,
  expectedRole: "road-network",
});
assert.equal(loaded.artifact.schema, "nwe.road-network-artifact/0.1");
assert.equal(loaded.verification.code, "RUNTIME_VERIFICATION_PASS");
assert.equal(loaded.verification.decision, "READY_FOR_RUNTIME");
assert.equal(calls.length, 2);
assert.ok(calls.every((url) => !/(nvdb|vegvesen|openstreetmap|overpass)/i.test(url)));
cases += 1;

let sourceCalls = 0;
const maliciousBundle = buildBundle("https://nvdbapiles.atlas.vegvesen.no/raw");
const maliciousFetch = async () => {
  sourceCalls += 1;
  return { ok: true, status: 200, json: async () => maliciousBundle };
};
await assert.rejects(
  () => loadCompiledJsonArtifact({
    bundleUrl: "https://viewer.example/runtime/bad.bundle.json",
    fetchImpl: maliciousFetch,
    cryptoImpl: webcrypto,
  }),
  (error) => error.code === "RAW_SOURCE_REFERENCE_FORBIDDEN",
);
assert.equal(sourceCalls, 1, "raw source transport must be rejected before a second fetch");
cases += 1;

const forgedBundle = structuredClone(bundle);
forgedBundle.lineage_hash = "forged-lineage";
const forgedCalls = [];
await assert.rejects(
  () => loadCompiledJsonArtifact({
    bundleUrl: "https://viewer.example/runtime/forged.bundle.json",
    fetchImpl: fetchPair(forgedBundle, bytes, forgedCalls),
    cryptoImpl: webcrypto,
  }),
  (error) => error.code === "RUNTIME_VERIFICATION_REJECTED" && error.message.includes("LINEAGE_HASH_MISMATCH"),
);
assert.equal(forgedCalls.length, 2, "graph reconstruction occurs after compiled artifact fetch");
cases += 1;

const tampered = bytes.slice();
tampered[tampered.byteLength - 2] ^= 0x01;
const tamperCalls = [];
await assert.rejects(
  () => loadCompiledJsonArtifact({
    bundleUrl: "https://viewer.example/runtime/tampered.bundle.json",
    fetchImpl: fetchPair(bundle, tampered, tamperCalls),
    cryptoImpl: webcrypto,
  }),
  (error) => error.code === "ARTIFACT_SHA256_MISMATCH",
);
assert.equal(tamperCalls.length, 2);
cases += 1;

console.log(JSON.stringify({ status: "PASS", cases, network_calls: calls.length, raw_source_calls: 0, full_graph_verification: true }));
