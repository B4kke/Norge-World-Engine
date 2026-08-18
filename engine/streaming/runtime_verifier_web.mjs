import canonicalize from "canonicalize";

import {
  artifactIdentityPayload,
  RUNTIME_DECISION,
  runtimeBundlePreflight,
  runtimeHashTargets,
  runtimeVerificationFailure,
  verifyRuntimeBundleFromHashes,
} from "./runtime_verifier_core.mjs";

export { artifactIdentityPayload, RUNTIME_DECISION };

const encoder = new TextEncoder();

function canonicalBytes(value) {
  const text = canonicalize(value);
  if (text === undefined) throw new TypeError("value cannot be serialized by RFC 8785/JCS");
  return encoder.encode(text);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes, cryptoImpl) {
  if (!cryptoImpl?.subtle) throw new Error("WEBCRYPTO_REQUIRED:crypto.subtle is unavailable");
  return toHex(await cryptoImpl.subtle.digest("SHA-256", bytes));
}

async function canonicalSha256Web(value, cryptoImpl) {
  return sha256(canonicalBytes(value), cryptoImpl);
}

async function asyncHashManifest(bundle, artifactBytes, cryptoImpl) {
  const targets = runtimeHashTargets(bundle);
  const [
    sourceSnapshotHashes,
    transformContractHashes,
    normalizedSnapshotHashes,
    compilerConfigHash,
    lineageHash,
    artifactRefHash,
    promotionRecordHash,
    artifactSha256,
  ] = await Promise.all([
    Promise.all(targets.sourceSnapshots.map((value) => canonicalSha256Web(value, cryptoImpl))),
    Promise.all(targets.transformContracts.map((value) => canonicalSha256Web(value, cryptoImpl))),
    Promise.all(targets.normalizedSnapshots.map((value) => canonicalSha256Web(value, cryptoImpl))),
    canonicalSha256Web(targets.compilerConfig, cryptoImpl),
    canonicalSha256Web(targets.compileLineage, cryptoImpl),
    canonicalSha256Web(targets.artifactIdentity, cryptoImpl),
    canonicalSha256Web(targets.promotionRecord, cryptoImpl),
    artifactBytes instanceof Uint8Array ? sha256(artifactBytes, cryptoImpl) : Promise.resolve(null),
  ]);
  return {
    sourceSnapshotHashes,
    transformContractHashes,
    normalizedSnapshotHashes,
    compilerConfigHash,
    lineageHash,
    artifactRefHash,
    promotionRecordHash,
    artifactSha256,
  };
}

export async function verifyRuntimeBundleWeb(bundle, artifactBytes, { cryptoImpl = globalThis.crypto } = {}) {
  const preflight = runtimeBundlePreflight(bundle);
  if (preflight) return preflight;
  if (!cryptoImpl?.subtle) {
    return runtimeVerificationFailure("WEBCRYPTO_REQUIRED", "crypto.subtle is unavailable");
  }
  try {
    const hashes = await asyncHashManifest(bundle, artifactBytes, cryptoImpl);
    return verifyRuntimeBundleFromHashes(bundle, artifactBytes, hashes);
  } catch (error) {
    return runtimeVerificationFailure(
      "BUNDLE_RECONSTRUCTION_ERROR",
      error instanceof Error ? error.message : String(error),
    );
  }
}
