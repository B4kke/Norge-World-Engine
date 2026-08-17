import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { canonicalSha256 } from "../schemas/js/src/canonical.mjs";
import { artifactIdentityPayload, RUNTIME_DECISION, verifyRuntimeBundle } from "./runtime_verifier.mjs";

const bytes = new TextEncoder().encode("compiled-terrain-fixture");
const artifactSha = createHash("sha256").update(bytes).digest("hex");

function buildBundle(reference = "cache://compiled/nannestad-terrain.glb") {
  const source = {
    schema: "nwe.source-snapshot/0.3",
    source_id: "fixture:dtm1",
    raw_sha256: "a".repeat(64),
    raw_byte_size: 123,
    source_crs: "EPSG:25832",
    source_vertical_datum: "NN2000",
    z_semantics: "normal_height_m",
  };
  const sourceHash = canonicalSha256(source);

  const transform = {
    schema: "nwe.transform-contract/0.1",
    source_snapshot_hash: sourceHash,
    operation: "pixel-aligned-window-no-resampling",
    bounds_epsg25832: ["611000", "6677000", "612000", "6678000"],
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
    media_type: "image/tiff; profile=nwe-normalized-dtm",
  };
  const normalizedHash = canonicalSha256(normalized);

  const compilerConfig = {
    schema: "nwe.compiler-config/0.1",
    compiler_id: "nwe-world-compiler",
    compiler_version: "0.1.0",
    terrain_format: "fixture-glb",
  };
  const compilerConfigHash = canonicalSha256(compilerConfig);

  const lineage = {
    schema: "nwe.compile-lineage/0.1",
    tile_id: "epsg25832_611000_6677000_1000m",
    artifact_role: "terrain-render",
    source_snapshot_hashes: [sourceHash],
    normalized_snapshot_hashes: [normalizedHash],
    compiler_config_hash: compilerConfigHash,
  };
  const lineageHash = canonicalSha256(lineage);

  const artifactRef = {
    schema: "nwe.artifact-ref/0.1",
    artifact_role: "terrain-render",
    tile_id: lineage.tile_id,
    sha256: artifactSha,
    byte_size: bytes.byteLength,
    media_type: "model/gltf-binary",
    lineage_hash: lineageHash,
    artifact_status: "REAL_COMPILED",
    transport: { reference },
  };
  const artifactRefHash = canonicalSha256(artifactIdentityPayload(artifactRef));

  const gates = {
    source_validated: "PASS",
    transform_validated: "PASS",
    normalized_bytes_verified: "PASS",
    compiler_identity_bound: "PASS",
    artifact_bytes_verified: "PASS",
    lineage_reconstructed: "PASS",
    determinism_policy_satisfied: "PASS",
  };
  const promotion = {
    schema: "nwe.promotion-record/0.1",
    lineage_hash: lineageHash,
    artifact_ref_hash: artifactRefHash,
    from_state: "NORMALIZED",
    to_state: "REAL_COMPILED",
    gates,
  };
  const promotionHash = canonicalSha256(promotion);

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
    promotion_record_hash: promotionHash,
  };
}

const valid = buildBundle();
assert.equal(verifyRuntimeBundle(valid, bytes).decision, RUNTIME_DECISION.READY);

// Transport relocation must not alter immutable artifact identity.
const relocated = structuredClone(valid);
relocated.artifact_ref.transport.reference = "https://cdn.example.invalid/nannestad-terrain.glb";
assert.equal(verifyRuntimeBundle(relocated, bytes).decision, RUNTIME_DECISION.READY);

// 1 m clip mutation must break the reconstructed transform/normalized chain.
const clipMutation = structuredClone(valid);
clipMutation.transform_contracts[0].bounds_epsg25832[0] = "611001";
assert.equal(verifyRuntimeBundle(clipMutation, bytes).decision, RUNTIME_DECISION.REJECTED);

// SENTINEL regression: self-reported forged lineage + internally rewritten downstream hashes must still fail.
const forged = structuredClone(valid);
forged.lineage_hash = "forged-lineage-not-reconstructed";
forged.artifact_ref.lineage_hash = forged.lineage_hash;
forged.artifact_ref_hash = canonicalSha256(artifactIdentityPayload(forged.artifact_ref));
forged.promotion_record.lineage_hash = forged.lineage_hash;
forged.promotion_record.artifact_ref_hash = forged.artifact_ref_hash;
forged.promotion_record_hash = canonicalSha256(forged.promotion_record);
const forgedResult = verifyRuntimeBundle(forged, bytes);
assert.equal(forgedResult.decision, RUNTIME_DECISION.REJECTED);
assert.equal(forgedResult.code, "LINEAGE_HASH_MISMATCH");

const rawSource = buildBundle("https://nedlasting.geonorge.no/raw/source.tif");
assert.equal(verifyRuntimeBundle(rawSource, bytes).code, "RAW_SOURCE_REFERENCE_FORBIDDEN");

const wrongBytes = new TextEncoder().encode("tampered");
assert.equal(verifyRuntimeBundle(valid, wrongBytes).decision, RUNTIME_DECISION.REJECTED);

console.log(JSON.stringify({ status: "PASS", cases: 6 }));
