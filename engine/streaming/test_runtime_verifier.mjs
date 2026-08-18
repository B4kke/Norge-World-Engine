import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";

import { canonicalSha256 } from "../schemas/js/src/canonical.mjs";
import { artifactIdentityPayload, RUNTIME_DECISION, verifyRuntimeBundle } from "./runtime_verifier.mjs";
import { verifyRuntimeBundleWeb } from "./runtime_verifier_web.mjs";

const bytes = new TextEncoder().encode("compiled-terrain-fixture");
const artifactSha = createHash("sha256").update(bytes).digest("hex");

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

function finishBundle({ sources, transforms, normalized, compilerConfig, lineage, reference }) {
  const sourceHashes = sources.map((source) => canonicalSha256(source)).sort();
  const transformHashes = transforms.map((transform) => canonicalSha256(transform)).sort();
  const normalizedHashes = normalized.map((item) => canonicalSha256(item)).sort();
  const compilerConfigHash = canonicalSha256(compilerConfig);
  const completeLineage = {
    ...lineage,
    source_snapshot_hashes: sourceHashes,
    normalized_snapshot_hashes: normalizedHashes,
    compiler_config_hash: compilerConfigHash,
  };
  const lineageHash = canonicalSha256(completeLineage);
  const artifactRef = {
    schema: "nwe.artifact-ref/0.1",
    artifact_role: completeLineage.artifact_role,
    tile_id: completeLineage.tile_id,
    sha256: artifactSha,
    byte_size: bytes.byteLength,
    media_type: "model/gltf-binary",
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
    source_snapshots: sources,
    source_snapshot_hashes: sourceHashes,
    transform_contracts: transforms,
    transform_contract_hashes: transformHashes,
    normalized_snapshots: normalized,
    normalized_snapshot_hashes: normalizedHashes,
    compiler_config: compilerConfig,
    compiler_config_hash: compilerConfigHash,
    compile_lineage: completeLineage,
    lineage_hash: lineageHash,
    artifact_ref: artifactRef,
    artifact_ref_hash: artifactRefHash,
    promotion_record: promotion,
    promotion_record_hash: canonicalSha256(promotion),
  };
}

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

  return finishBundle({
    sources: [source],
    transforms: [transform],
    normalized: [normalized],
    compilerConfig: {
      schema: "nwe.compiler-config/0.1",
      compiler_id: "nwe-world-compiler",
      compiler_version: "0.1.0",
      terrain_format: "fixture-glb",
    },
    lineage: {
      schema: "nwe.compile-lineage/0.1",
      tile_id: "epsg25832_611000_6677000_1000m",
      artifact_role: "terrain-render",
    },
    reference,
  });
}

function buildMultiSourceBundle() {
  const sourceA = {
    schema: "nwe.source-snapshot/0.3",
    source_id: "fixture:dtm1:a",
    raw_sha256: "1".repeat(64),
    raw_byte_size: 111,
    source_crs: "EPSG:25833",
    source_vertical_datum: "NN2000",
    z_semantics: "normal_height_m",
  };
  const sourceB = {
    schema: "nwe.source-snapshot/0.3",
    source_id: "fixture:dtm1:b",
    raw_sha256: "2".repeat(64),
    raw_byte_size: 222,
    source_crs: "EPSG:25833",
    source_vertical_datum: "NN2000",
    z_semantics: "normal_height_m",
  };
  const sourceHashes = [canonicalSha256(sourceA), canonicalSha256(sourceB)].sort();
  const transform = {
    schema: "nwe.transform-contract/0.1",
    source_snapshot_hashes: sourceHashes,
    operation: "dtm1-source-mosaic-reproject-bilinear-fixed-grid-epsg25832",
    bounds_epsg25832: ["611000", "6676000", "612000", "6677000"],
    horizontal_crs: "EPSG:25832",
    source_crs: "EPSG:25833",
    vertical_datum: "NN2000",
    mosaic_source_count: 2,
    mosaic_overlap_policy: "require-match-before-reproject",
  };
  const transformHash = canonicalSha256(transform);
  const normalized = {
    schema: "nwe.normalized-snapshot/0.1",
    source_snapshot_hashes: sourceHashes,
    transform_contract_hash: transformHash,
    sha256: "3".repeat(64),
    byte_size: 789,
    media_type: "image/tiff; profile=nwe.normalized-dtm/0.2",
  };
  return finishBundle({
    sources: [sourceA, sourceB],
    transforms: [transform],
    normalized: [normalized],
    compilerConfig: {
      schema: "nwe.compiler-config/0.1",
      compiler_id: "nwe-world-compiler",
      compiler_version: "0.1.0",
      terrain_format: "nwe-height-grid/0.1",
    },
    lineage: {
      schema: "nwe.compile-lineage/0.1",
      tile_id: "epsg25832_611000_6676000_1000m",
      artifact_role: "terrain-render",
    },
    reference: "cache://compiled/mosaic-terrain.glb",
  });
}

function rehashNormalizedAndDownstream(bundle) {
  bundle.normalized_snapshot_hashes = bundle.normalized_snapshots.map((item) => canonicalSha256(item)).sort();
  bundle.compile_lineage.source_snapshot_hashes = [...bundle.source_snapshot_hashes];
  bundle.compile_lineage.normalized_snapshot_hashes = [...bundle.normalized_snapshot_hashes];
  bundle.lineage_hash = canonicalSha256(bundle.compile_lineage);
  bundle.artifact_ref.lineage_hash = bundle.lineage_hash;
  bundle.artifact_ref_hash = canonicalSha256(artifactIdentityPayload(bundle.artifact_ref));
  bundle.promotion_record.lineage_hash = bundle.lineage_hash;
  bundle.promotion_record.artifact_ref_hash = bundle.artifact_ref_hash;
  bundle.promotion_record_hash = canonicalSha256(bundle.promotion_record);
}

let cases = 0;

const valid = buildBundle();
assert.equal(verifyRuntimeBundle(valid, bytes).decision, RUNTIME_DECISION.READY);
cases += 1;

const relocated = structuredClone(valid);
relocated.artifact_ref.transport.reference = "https://cdn.example.invalid/nannestad-terrain.glb";
assert.equal(verifyRuntimeBundle(relocated, bytes).decision, RUNTIME_DECISION.READY);
cases += 1;

const clipMutation = structuredClone(valid);
clipMutation.transform_contracts[0].bounds_epsg25832[0] = "611001";
assert.equal(verifyRuntimeBundle(clipMutation, bytes).decision, RUNTIME_DECISION.REJECTED);
cases += 1;

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
cases += 1;

const rawSource = buildBundle("https://nedlasting.geonorge.no/raw/source.tif");
assert.equal(verifyRuntimeBundle(rawSource, bytes).code, "RAW_SOURCE_REFERENCE_FORBIDDEN");
cases += 1;

const wrongBytes = new TextEncoder().encode("tampered");
assert.equal(verifyRuntimeBundle(valid, wrongBytes).decision, RUNTIME_DECISION.REJECTED);
cases += 1;

const multi = buildMultiSourceBundle();
assert.equal(verifyRuntimeBundle(multi, bytes).decision, RUNTIME_DECISION.READY);
assert.equal(verifyRuntimeBundle(multi, bytes).reconstructed.source_snapshot_hashes.length, 2);
cases += 1;

const missingMosaicSource = structuredClone(multi);
missingMosaicSource.normalized_snapshots[0].source_snapshot_hashes = [multi.source_snapshot_hashes[0]];
rehashNormalizedAndDownstream(missingMosaicSource);
assert.equal(verifyRuntimeBundle(missingMosaicSource, bytes).code, "NORMALIZED_SOURCE_SET_MISMATCH");
cases += 1;

const unusedSource = structuredClone(multi);
const sourceC = {
  schema: "nwe.source-snapshot/0.3",
  source_id: "fixture:unused",
  raw_sha256: "4".repeat(64),
  raw_byte_size: 333,
  source_crs: "EPSG:25833",
  source_vertical_datum: "NN2000",
  z_semantics: "normal_height_m",
};
unusedSource.source_snapshots.push(sourceC);
unusedSource.source_snapshot_hashes = unusedSource.source_snapshots.map((item) => canonicalSha256(item)).sort();
rehashNormalizedAndDownstream(unusedSource);
assert.equal(verifyRuntimeBundle(unusedSource, bytes).code, "UNUSED_SOURCE_SNAPSHOT");
cases += 1;

const unusedTransform = structuredClone(multi);
const extraTransform = {
  schema: "nwe.transform-contract/0.1",
  source_snapshot_hash: multi.source_snapshot_hashes[0],
  operation: "unused-transform",
};
unusedTransform.transform_contracts.push(extraTransform);
unusedTransform.transform_contract_hashes = unusedTransform.transform_contracts.map((item) => canonicalSha256(item)).sort();
assert.equal(verifyRuntimeBundle(unusedTransform, bytes).code, "UNUSED_TRANSFORM_CONTRACT");
cases += 1;

const unsortedPlural = structuredClone(multi);
unsortedPlural.transform_contracts[0].source_snapshot_hashes.reverse();
unsortedPlural.transform_contract_hashes = unsortedPlural.transform_contracts.map((item) => canonicalSha256(item)).sort();
const unsortedResult = verifyRuntimeBundle(unsortedPlural, bytes);
assert.equal(unsortedResult.code, "BUNDLE_RECONSTRUCTION_ERROR");
cases += 1;

const parityCases = [
  ["valid", valid, bytes],
  ["relocated", relocated, bytes],
  ["clip-mutation", clipMutation, bytes],
  ["forged-lineage", forged, bytes],
  ["raw-source-reference", rawSource, bytes],
  ["wrong-artifact-bytes", valid, wrongBytes],
  ["multi-source-valid", multi, bytes],
  ["multi-source-missing-source", missingMosaicSource, bytes],
  ["unused-source", unusedSource, bytes],
  ["unused-transform", unusedTransform, bytes],
  ["unsorted-plural", unsortedPlural, bytes],
];

for (const [name, bundle, artifactBytes] of parityCases) {
  const nodeResult = verifyRuntimeBundle(bundle, artifactBytes);
  const webResult = await verifyRuntimeBundleWeb(bundle, artifactBytes, { cryptoImpl: webcrypto });
  assert.equal(webResult.decision, nodeResult.decision, `${name}: decision parity`);
  assert.equal(webResult.code, nodeResult.code, `${name}: failure/pass code parity`);
  assert.deepEqual(webResult.reconstructed ?? null, nodeResult.reconstructed ?? null, `${name}: reconstructed hash parity`);
}

const missingCrypto = await verifyRuntimeBundleWeb(valid, bytes, { cryptoImpl: null });
assert.equal(missingCrypto.code, "WEBCRYPTO_REQUIRED");

console.log(JSON.stringify({ status: "PASS", cases, browser_parity_cases: parityCases.length, webcrypto_required_case: 1 }));
