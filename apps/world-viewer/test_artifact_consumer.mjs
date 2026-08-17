import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { loadCompiledJsonArtifact } from "./artifact_consumer.mjs";

const artifact = { schema: "nwe.road-network-artifact/0.1", tile_id: "tile", paths: [] };
const bytes = new TextEncoder().encode(JSON.stringify(artifact));
const sha = createHash("sha256").update(bytes).digest("hex");
const bundle = {
  artifact_ref: {
    schema: "nwe.artifact-ref/0.1",
    artifact_role: "road-network",
    artifact_status: "REAL_COMPILED",
    sha256: sha,
    byte_size: bytes.byteLength,
    transport: { reference: "cache://compiled/tile/road-network/hash.json" },
  },
};
const calls = [];
const fetchImpl = async (url) => {
  calls.push(String(url));
  if (calls.length === 1) return { ok: true, status: 200, json: async () => bundle };
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const loaded = await loadCompiledJsonArtifact({
  bundleUrl: "https://viewer.example/runtime/roads.bundle.json",
  fetchImpl,
  cryptoImpl: webcrypto,
  expectedRole: "road-network",
});
assert.equal(loaded.artifact.schema, "nwe.road-network-artifact/0.1");
assert.equal(calls.length, 2);
assert.ok(calls.every((url) => !/(nvdb|vegvesen|openstreetmap|overpass)/i.test(url)));

let sourceCalls = 0;
const maliciousFetch = async () => {
  sourceCalls += 1;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      artifact_ref: {
        schema: "nwe.artifact-ref/0.1",
        artifact_role: "road-network",
        artifact_status: "REAL_COMPILED",
        sha256: sha,
        byte_size: bytes.byteLength,
        transport: { reference: "https://nvdbapiles.atlas.vegvesen.no/raw" },
      },
    }),
  };
};
await assert.rejects(
  () => loadCompiledJsonArtifact({ bundleUrl: "https://viewer.example/runtime/bad.bundle.json", fetchImpl: maliciousFetch, cryptoImpl: webcrypto }),
  (error) => error.code === "RAW_SOURCE_REFERENCE_FORBIDDEN",
);
assert.equal(sourceCalls, 1, "raw source transport must be rejected before a second fetch");

console.log(JSON.stringify({ status: "PASS", cases: 2, network_calls: calls.length, raw_source_calls: 0 }));
