import { createHash } from "node:crypto";

import { canonicalSha256 } from "../schemas/js/src/canonical.mjs";

export const RUNTIME_DECISION = Object.freeze({
  READY: "READY_FOR_RUNTIME",
  NOT_READY: "NOT_RUNTIME_READY",
  REJECTED: "REJECTED",
});

const BUNDLE_SCHEMA = "nwe.runtime-verification-bundle/0.1";
const CANONICALIZATION_ID = "urn:ietf:rfc:8785";
const HASH_ALGORITHM = "sha-256";

const REQUIRED_GATES = [
  "source_validated",
  "transform_validated",
  "normalized_bytes_verified",
  "compiler_identity_bound",
  "artifact_bytes_verified",
  "lineage_reconstructed",
  "determinism_policy_satisfied",
];

const RAW_SOURCE_MARKERS = [
  "geonorge",
  "kartverket",
  "vegvesen",
  "nvdb",
  "overpass",
  "openstreetmap",
];

function fail(code, detail) {
  return { ok: false, decision: RUNTIME_DECISION.REJECTED, code, detail };
}

function ensureSchema(value, expected, code) {
  if (!value || typeof value !== "object" || value.schema !== expected) {
    throw new Error(`${code}:${value?.schema ?? "missing"}`);
  }
}

function uniqueMap(objects, expectedSchema, kind) {
  const result = new Map();
  for (const object of objects ?? []) {
    ensureSchema(object, expectedSchema, `${kind.toUpperCase()}_SCHEMA`);
    const hash = canonicalSha256(object);
    if (result.has(hash)) throw new Error(`${kind.toUpperCase()}_DUPLICATE_HASH:${hash}`);
    result.set(hash, object);
  }
  return result;
}

function equalStringArrays(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

function sortedUniqueStrings(values, code) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== "string" || !value)) {
    throw new Error(`${code}:source references must be a non-empty string array`);
  }
  const sorted = [...new Set(values)].sort();
  if (sorted.length !== values.length || !equalStringArrays(values, sorted)) {
    throw new Error(`${code}:source references must be unique and sorted`);
  }
  return sorted;
}

function sourceRefs(object, code) {
  const singular = object?.source_snapshot_hash;
  const plural = object?.source_snapshot_hashes;
  if (singular != null && plural != null) {
    throw new Error(`${code}:singular and plural source references are mutually exclusive`);
  }
  if (singular != null) {
    if (typeof singular !== "string" || !singular) throw new Error(`${code}:invalid singular source reference`);
    return [singular];
  }
  if (plural != null) return sortedUniqueStrings(plural, code);
  throw new Error(`${code}:source reference missing`);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRawSourceReference(reference) {
  if (typeof reference !== "string" || !/^https?:\/\//i.test(reference)) return false;
  const lower = reference.toLowerCase();
  return RAW_SOURCE_MARKERS.some((marker) => lower.includes(marker));
}

export function artifactIdentityPayload(artifactRef) {
  const { transport, transport_mutable: _transportMutable, reference: _legacyReference, ...immutable } = artifactRef;
  return immutable;
}

export function verifyRuntimeBundle(bundle, artifactBytes) {
  try {
    if (!bundle || typeof bundle !== "object") return fail("INVALID_BUNDLE", "bundle missing");
    if (bundle.bundle_schema !== BUNDLE_SCHEMA) return fail("UNKNOWN_BUNDLE_SCHEMA", String(bundle.bundle_schema));
    if (bundle.canonicalization_id !== CANONICALIZATION_ID) {
      return fail("UNKNOWN_CANONICALIZATION", String(bundle.canonicalization_id));
    }
    if (bundle.hash_algorithm !== HASH_ALGORITHM) return fail("UNKNOWN_HASH_ALGORITHM", String(bundle.hash_algorithm));

    const sourceMap = uniqueMap(bundle.source_snapshots, "nwe.source-snapshot/0.3", "source_snapshot");
    const expectedSourceHashes = [...sourceMap.keys()].sort();
    if (!expectedSourceHashes.length) return fail("SOURCE_SET_EMPTY", "bundle contains no source snapshots");
    if (!equalStringArrays(bundle.source_snapshot_hashes, expectedSourceHashes)) {
      return fail("SOURCE_HASH_SET_MISMATCH", "bundle source_snapshot_hashes do not match reconstructed hashes");
    }

    const transformMap = uniqueMap(bundle.transform_contracts, "nwe.transform-contract/0.1", "transform_contract");
    if (!transformMap.size) return fail("TRANSFORM_SET_EMPTY", "bundle contains no transform contracts");
    const transformSourceRefs = new Map();
    const referencedSourceHashes = new Set();
    for (const [transformHash, transform] of transformMap.entries()) {
      const refs = sourceRefs(transform, "TRANSFORM_SOURCE_REF");
      for (const sourceHash of refs) {
        if (!sourceMap.has(sourceHash)) return fail("TRANSFORM_SOURCE_REF_MISSING", sourceHash);
        referencedSourceHashes.add(sourceHash);
      }
      transformSourceRefs.set(transformHash, refs);
    }
    const expectedTransformHashes = [...transformMap.keys()].sort();
    if (!equalStringArrays(bundle.transform_contract_hashes, expectedTransformHashes)) {
      return fail("TRANSFORM_HASH_SET_MISMATCH", "bundle transform_contract_hashes do not match reconstructed hashes");
    }

    const normalizedMap = uniqueMap(
      bundle.normalized_snapshots,
      "nwe.normalized-snapshot/0.1",
      "normalized_snapshot",
    );
    if (!normalizedMap.size) return fail("NORMALIZED_SET_EMPTY", "bundle contains no normalized snapshots");
    const referencedTransformHashes = new Set();
    for (const normalized of normalizedMap.values()) {
      const refs = sourceRefs(normalized, "NORMALIZED_SOURCE_REF");
      for (const sourceHash of refs) {
        if (!sourceMap.has(sourceHash)) return fail("NORMALIZED_SOURCE_REF_MISSING", sourceHash);
      }
      if (!transformMap.has(normalized.transform_contract_hash)) {
        return fail("NORMALIZED_TRANSFORM_REF_MISSING", normalized.transform_contract_hash);
      }
      const transformRefs = transformSourceRefs.get(normalized.transform_contract_hash);
      if (!equalStringArrays(refs, transformRefs)) {
        return fail(
          "NORMALIZED_SOURCE_SET_MISMATCH",
          "normalized source set must exactly match its transform source set",
        );
      }
      referencedTransformHashes.add(normalized.transform_contract_hash);
    }
    const expectedNormalizedHashes = [...normalizedMap.keys()].sort();
    if (!equalStringArrays(bundle.normalized_snapshot_hashes, expectedNormalizedHashes)) {
      return fail("NORMALIZED_HASH_SET_MISMATCH", "bundle normalized_snapshot_hashes do not match reconstructed hashes");
    }

    if (referencedTransformHashes.size !== transformMap.size) {
      const unused = expectedTransformHashes.filter((hash) => !referencedTransformHashes.has(hash));
      return fail("UNUSED_TRANSFORM_CONTRACT", unused.join(","));
    }
    const usedSourceHashes = [...referencedSourceHashes].sort();
    if (!equalStringArrays(usedSourceHashes, expectedSourceHashes)) {
      const unused = expectedSourceHashes.filter((hash) => !referencedSourceHashes.has(hash));
      return fail("UNUSED_SOURCE_SNAPSHOT", unused.join(","));
    }

    ensureSchema(bundle.compiler_config, "nwe.compiler-config/0.1", "COMPILER_CONFIG_SCHEMA");
    const compilerConfigHash = canonicalSha256(bundle.compiler_config);
    if (bundle.compiler_config_hash !== compilerConfigHash) {
      return fail("COMPILER_CONFIG_HASH_MISMATCH", `${bundle.compiler_config_hash} != ${compilerConfigHash}`);
    }

    ensureSchema(bundle.compile_lineage, "nwe.compile-lineage/0.1", "COMPILE_LINEAGE_SCHEMA");
    const lineage = bundle.compile_lineage;
    if (!equalStringArrays(lineage.source_snapshot_hashes, expectedSourceHashes)) {
      return fail("LINEAGE_SOURCE_SET_MISMATCH", "compile lineage source set mismatch");
    }
    if (!equalStringArrays(lineage.normalized_snapshot_hashes, expectedNormalizedHashes)) {
      return fail("LINEAGE_NORMALIZED_SET_MISMATCH", "compile lineage normalized set mismatch");
    }
    if (lineage.compiler_config_hash !== compilerConfigHash) {
      return fail("LINEAGE_CONFIG_MISMATCH", lineage.compiler_config_hash);
    }
    const lineageHash = canonicalSha256(lineage);
    if (bundle.lineage_hash !== lineageHash) {
      return fail("LINEAGE_HASH_MISMATCH", `${bundle.lineage_hash} != ${lineageHash}`);
    }

    ensureSchema(bundle.artifact_ref, "nwe.artifact-ref/0.1", "ARTIFACT_REF_SCHEMA");
    const artifactRef = bundle.artifact_ref;
    if (artifactRef.lineage_hash !== lineageHash) return fail("ARTIFACT_LINEAGE_MISMATCH", artifactRef.lineage_hash);
    if (artifactRef.artifact_status !== "REAL_COMPILED") {
      return fail("ARTIFACT_NOT_REAL_COMPILED", String(artifactRef.artifact_status));
    }
    if (artifactRef.tile_id !== lineage.tile_id) return fail("ARTIFACT_TILE_MISMATCH", artifactRef.tile_id);
    if (artifactRef.artifact_role !== lineage.artifact_role) {
      return fail("ARTIFACT_ROLE_MISMATCH", artifactRef.artifact_role);
    }
    const artifactRefHash = canonicalSha256(artifactIdentityPayload(artifactRef));
    if (bundle.artifact_ref_hash !== artifactRefHash) {
      return fail("ARTIFACT_REF_HASH_MISMATCH", `${bundle.artifact_ref_hash} != ${artifactRefHash}`);
    }

    const reference = artifactRef.transport?.reference ?? artifactRef.reference;
    if (!reference) return fail("ARTIFACT_REFERENCE_MISSING", "transport reference missing");
    if (isRawSourceReference(reference)) return fail("RAW_SOURCE_REFERENCE_FORBIDDEN", reference);

    ensureSchema(bundle.promotion_record, "nwe.promotion-record/0.1", "PROMOTION_RECORD_SCHEMA");
    const promotion = bundle.promotion_record;
    if (promotion.lineage_hash !== lineageHash) return fail("PROMOTION_LINEAGE_MISMATCH", promotion.lineage_hash);
    if (promotion.artifact_ref_hash !== artifactRefHash) {
      return fail("PROMOTION_ARTIFACT_REF_MISMATCH", promotion.artifact_ref_hash);
    }
    if (promotion.from_state !== "NORMALIZED" || promotion.to_state !== "REAL_COMPILED") {
      return fail("PROMOTION_STATE_INVALID", `${promotion.from_state}->${promotion.to_state}`);
    }
    const gates = promotion.gates ?? {};
    const failedGates = REQUIRED_GATES.filter((gate) => gates[gate] !== "PASS");
    if (failedGates.length) return fail("PROMOTION_GATE_NOT_PASS", failedGates.join(","));
    const promotionHash = canonicalSha256(promotion);
    if (bundle.promotion_record_hash !== promotionHash) {
      return fail("PROMOTION_RECORD_HASH_MISMATCH", `${bundle.promotion_record_hash} != ${promotionHash}`);
    }

    if (!(artifactBytes instanceof Uint8Array)) return fail("ARTIFACT_BYTES_MISSING", "bytes must be Uint8Array");
    if (artifactBytes.byteLength !== artifactRef.byte_size) {
      return fail("BYTE_SIZE_MISMATCH", `${artifactBytes.byteLength} != ${artifactRef.byte_size}`);
    }
    const actualArtifactHash = sha256Bytes(artifactBytes);
    if (actualArtifactHash !== artifactRef.sha256) {
      return fail("ARTIFACT_SHA256_MISMATCH", `${actualArtifactHash} != ${artifactRef.sha256}`);
    }

    return {
      ok: true,
      decision: RUNTIME_DECISION.READY,
      code: "RUNTIME_VERIFICATION_PASS",
      reconstructed: {
        source_snapshot_hashes: expectedSourceHashes,
        transform_contract_hashes: expectedTransformHashes,
        normalized_snapshot_hashes: expectedNormalizedHashes,
        compiler_config_hash: compilerConfigHash,
        lineage_hash: lineageHash,
        artifact_ref_hash: artifactRefHash,
        promotion_record_hash: promotionHash,
      },
    };
  } catch (error) {
    return fail("BUNDLE_RECONSTRUCTION_ERROR", error instanceof Error ? error.message : String(error));
  }
}
