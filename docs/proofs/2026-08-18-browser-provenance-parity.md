# Browser provenance parity proof — 2026-08-18

## Scope

This proof covers full `RuntimeVerificationBundle` reconstruction in a real browser runtime using the same provenance semantics as the existing Node verifier.

It does **not** select a renderer, change source/compiler contracts, weaken raw-source networking rules, close the DTM1 multi-source seam gate or claim Android performance acceptance.

## Architecture

Runtime provenance verification is split into three layers:

- `engine/streaming/runtime_verifier_core.mjs` — crypto-agnostic semantic verifier. Owns source/transform/normalized graph closure, singular/plural source references, compiler config identity, compile lineage, immutable ArtifactRef identity, raw-source transport rejection, promotion states/gates and artifact byte size/SHA decisions.
- `engine/streaming/runtime_verifier.mjs` — synchronous Node SHA-256 adapter using `node:crypto` and the existing RFC 8785/JCS canonicalization helper.
- `engine/streaming/runtime_verifier_web.mjs` — asynchronous browser adapter using the same pinned `canonicalize@3.0.0`, `TextEncoder` and WebCrypto SHA-256.

The semantic policy therefore exists once. Node and browser adapters only calculate the hashes required by the shared verifier.

## Node ↔ WebCrypto parity

Initial refactor head: `d4354a93db23496edaf9d2dfee1cfa8c00780652`  
Hosted baseline run: `32136500278`  
Result: **PASS**

The runtime regression executes all 11 existing happy/adversarial bundle cases through both adapters and requires:

- identical runtime decision;
- identical PASS/failure code;
- identical reconstructed source/transform/normalized/config/lineage/artifact/promotion hashes.

It also verifies an explicit `WEBCRYPTO_REQUIRED` rejection when `crypto.subtle` is unavailable.

## Browser artifact-consumer integration

Final PR head: `f435292b42c68889b235f5f1970fb4733bfda6a4`  
Full baseline run: `32136951635` — **PASS**  
Real-data Chrome viewer run: `32136951610` — **PASS**

`apps/world-viewer/artifact_consumer.mjs` now keeps the raw-source transport guard **before** artifact fetch, then requires full WebCrypto/JCS graph reconstruction to return `READY_FOR_RUNTIME / RUNTIME_VERIFICATION_PASS` before JSON decode.

Focused consumer regressions prove:

1. a complete valid provenance graph loads successfully;
2. NVDB/raw-source transport is rejected after only the bundle request — no raw-source artifact request occurs;
3. forged compile-lineage identity is rejected with `LINEAGE_HASH_MISMATCH`;
4. tampered compiled bytes are rejected with `ARTIFACT_SHA256_MISMATCH`.

The browser benchmark serves the locally installed pinned `canonicalize` ESM module through its localhost harness using an import map. No CDN or external runtime verifier dependency is used.

## Exact real vector artifacts in Chrome

The final Chrome run compiled and verified the same accepted Nannestad vector identities:

- roads: 246 paths, 171,732 B, SHA `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`;
- buildings: 135 footprints, 80,846 B, SHA `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`;
- raw-source runtime calls: **0**;
- real browser network: 4 localhost runtime requests — two bundles + two compiled artifacts.

The same full-provenance browser path still completed the fixed-camera batching benchmark:

- logical vector objects: **381**;
- draw calls: **381 -> 2**;
- frame p95: **50.0 -> 16.7 ms**;
- render-sync p95: **0.4 -> 0.2 ms**.

These frame timings are hosted/headless Chrome comparative evidence, not Android GPU acceptance.

## New performance observation

Full browser provenance reconstruction is correct but not free. Separate hosted runs provide a directional comparison:

Before full graph verification, final pre-merge viewer run `32135092313` reported:

- roads `verify_decode_ms`: ~**112.9 ms**;
- buildings `verify_decode_ms`: ~**89.8 ms**;
- boot-to-first-visible: ~**788.5 ms**.

With full browser graph verification, run `32136951610` reported:

- roads `verify_decode_ms`: ~**201.7 ms**;
- buildings `verify_decode_ms`: ~**173.4 ms**;
- boot-to-first-visible: ~**993.5 ms**.

The runs are not a controlled microbenchmark of provenance hashing alone: geometry build and GPU upload also varied. Therefore the delta must **not** be interpreted as an exact causal cost. It is strong enough to establish a performance question: full provenance verification should be instrumented on the target browser/device and may need off-main-thread execution and/or verified immutable-identity caching if device evidence shows first-visible or frame responsiveness is harmed.

Security semantics are not to be weakened to recover this time.

## Still open

- Exercise terrain `RuntimeVerificationBundle` verification with the same browser adapter; the real road/building Chrome path is proven, terrain browser movement remains a separate gate.
- Run real browser `DedicatedWorker` terrain decode/mesh generation rather than the hosted in-process protocol shim used by the accepted single-tile terrain proof.
- Measure provenance verification, worker transfer/startup, main-thread apply/GPU upload and rAF gaps on Android Chrome.
- Decide whether verification caching or a provenance worker is justified only after those measurements.
- Real 2×2/3×3 terrain remains blocked by the explicit DTM1 10 m overlap/seam contract.
