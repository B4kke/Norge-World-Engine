import { verifyRuntimeBundleWeb } from "../../engine/streaming/runtime_verifier_web.mjs";

const RAW_SOURCE_MARKERS = ["geonorge", "kartverket", "vegvesen", "nvdb", "overpass", "openstreetmap"];

export class ArtifactConsumerError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ArtifactConsumerError";
    this.code = code;
  }
}

export function assertCompiledTransport(reference) {
  if (typeof reference !== "string" || !reference) {
    throw new ArtifactConsumerError("ARTIFACT_REFERENCE_MISSING", "compiled artifact transport is missing");
  }
  const lower = reference.toLowerCase();
  if (RAW_SOURCE_MARKERS.some((marker) => lower.includes(marker))) {
    throw new ArtifactConsumerError("RAW_SOURCE_REFERENCE_FORBIDDEN", reference);
  }
  return reference;
}

export function defaultCacheResolver(reference, bundleUrl) {
  if (!reference.startsWith("cache://compiled/")) return new URL(reference, bundleUrl).href;
  const relative = reference.slice("cache://compiled/".length);
  return new URL(`./compiled/${relative}`, bundleUrl).href;
}

function verificationError(result) {
  if (result?.code === "BYTE_SIZE_MISMATCH") {
    return new ArtifactConsumerError("ARTIFACT_BYTE_SIZE_MISMATCH", result.detail);
  }
  if (result?.code === "ARTIFACT_SHA256_MISMATCH") {
    return new ArtifactConsumerError("ARTIFACT_SHA256_MISMATCH", result.detail);
  }
  return new ArtifactConsumerError(
    "RUNTIME_VERIFICATION_REJECTED",
    `${result?.code ?? "UNKNOWN"}: ${result?.detail ?? "bundle/artifact rejected"}`,
  );
}

export async function loadCompiledJsonArtifact({
  bundleUrl,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  resolveTransport = defaultCacheResolver,
  expectedRole = null,
}) {
  if (typeof fetchImpl !== "function") {
    throw new ArtifactConsumerError("FETCH_REQUIRED", "fetch implementation is unavailable");
  }
  const bundleResponse = await fetchImpl(bundleUrl, { cache: "no-store" });
  if (!bundleResponse.ok) {
    throw new ArtifactConsumerError("BUNDLE_FETCH_FAILED", `${bundleResponse.status} ${bundleUrl}`);
  }
  const bundle = await bundleResponse.json();
  const artifactRef = bundle?.artifact_ref;
  if (!artifactRef || artifactRef.schema !== "nwe.artifact-ref/0.1") {
    throw new ArtifactConsumerError("ARTIFACT_REF_INVALID", String(artifactRef?.schema ?? "missing"));
  }
  if (artifactRef.artifact_status !== "REAL_COMPILED") {
    throw new ArtifactConsumerError("ARTIFACT_NOT_REAL_COMPILED", String(artifactRef.artifact_status));
  }
  if (expectedRole && artifactRef.artifact_role !== expectedRole) {
    throw new ArtifactConsumerError("ARTIFACT_ROLE_MISMATCH", `${artifactRef.artifact_role} != ${expectedRole}`);
  }

  // Keep the pre-fetch transport guard even though the full verifier repeats the rule.
  // A malicious bundle must not gain a raw-source request merely because full graph
  // verification needs the compiled artifact bytes.
  const reference = assertCompiledTransport(artifactRef.transport?.reference ?? artifactRef.reference);
  const artifactUrl = resolveTransport(reference, bundleUrl);
  assertCompiledTransport(artifactUrl);

  const artifactResponse = await fetchImpl(artifactUrl, { cache: "force-cache" });
  if (!artifactResponse.ok) {
    throw new ArtifactConsumerError("ARTIFACT_FETCH_FAILED", `${artifactResponse.status} ${artifactUrl}`);
  }
  const bytes = new Uint8Array(await artifactResponse.arrayBuffer());
  const verification = await verifyRuntimeBundleWeb(bundle, bytes, { cryptoImpl });
  if (!verification.ok || verification.decision !== "READY_FOR_RUNTIME") {
    throw verificationError(verification);
  }

  let artifact;
  try {
    artifact = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new ArtifactConsumerError("ARTIFACT_JSON_INVALID", error instanceof Error ? error.message : String(error));
  }
  return { bundle, artifactRef, artifact, artifactUrl, bytes, verification };
}
