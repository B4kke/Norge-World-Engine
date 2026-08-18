import { createHash } from "node:crypto";

import { canonicalSha256 } from "../schemas/js/src/canonical.mjs";
import {
  artifactIdentityPayload,
  RUNTIME_DECISION,
  runtimeBundlePreflight,
  runtimeHashTargets,
  runtimeVerificationFailure,
  verifyRuntimeBundleFromHashes,
} from "./runtime_verifier_core.mjs";

export { artifactIdentityPayload, RUNTIME_DECISION };

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function syncHashManifest(bundle, artifactBytes) {
  const targets = runtimeHashTargets(bundle);
  return {
    sourceSnapshotHashes: targets.sourceSnapshots.map((value) => canonicalSha256(value)),
    transformContractHashes: targets.transformContracts.map((value) => canonicalSha256(value)),
    normalizedSnapshotHashes: targets.normalizedSnapshots.map((value) => canonicalSha256(value)),
    compilerConfigHash: canonicalSha256(targets.compilerConfig),
    lineageHash: canonicalSha256(targets.compileLineage),
    artifactRefHash: canonicalSha256(targets.artifactIdentity),
    promotionRecordHash: canonicalSha256(targets.promotionRecord),
    artifactSha256: artifactBytes instanceof Uint8Array ? sha256Bytes(artifactBytes) : null,
  };
}

export function verifyRuntimeBundle(bundle, artifactBytes) {
  const preflight = runtimeBundlePreflight(bundle);
  if (preflight) return preflight;
  try {
    return verifyRuntimeBundleFromHashes(bundle, artifactBytes, syncHashManifest(bundle, artifactBytes));
  } catch (error) {
    return runtimeVerificationFailure(
      "BUNDLE_RECONSTRUCTION_ERROR",
      error instanceof Error ? error.message : String(error),
    );
  }
}
