# Nannestad vector real-data proof — 2026-08-17

Status: **PASS** on GitHub-hosted Ubuntu runner.  
Branch: `agent/nvdb-osm-compiler-adapters`  
PR: #4, still draft and unmerged.  
Proof workflow: `vector-realdata-proof`, successful run `32061312881` on commit `f2118fd870b840021c86f4f136b5a01532a73e9a`.

## What changed

Making the repository public restored normal GitHub-hosted Actions execution. The first real-data compiler attempt then failed against NVDB with HTTP 400. NVDB API Les V4 requires the caller to identify the client with `X-Client`; `nwe_compiler.acquisition` now sends `X-Client: NorgeWorldEngine-Compiler` to the NVDB host and has a regression for that request boundary.

## Mobile capture evidence

The Android capture was base64-decoded before verification. Declared byte sizes and SHA-256 values match the decoded raw bytes.

- NVDB: 722,013 bytes, 471 raw/selected objects, SHA-256 `789aef2ba8792bfd15d7ed814628aae8f991d1d98e74a079b11a71666ea86c30`.
- OSM: 1,053,121 bytes, 5,704 elements / 141 building candidates, mobile-capture SHA-256 `dcc09b16ce0a09aa0ec8a632e87d23e17f3977b7d1583871b46b2cabf2a48f6c`.

The runner later acquired byte-identical NVDB data. OSM retained the same byte count and 5,704/141 counts but returned different raw bytes (`d14a6d75...`), which is correctly represented as a different SourceSnapshot rather than being hidden.

## Cold live compile

### Roads / NVDB

- raw objects: **471**
- source-selected WKT objects: **471**
- normalized tile-clipped segments: **407**
- compiled road paths: **246**
- raw bytes: **722,013**
- raw SHA-256: `789aef2ba8792bfd15d7ed814628aae8f991d1d98e74a079b11a71666ea86c30`
- artifact bytes: **171,732**
- artifact SHA-256: `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`
- acquire: **1966.896 ms**
- normalize + compile: **201.201 ms**
- persist: **0.862 ms**
- total: **2168.958 ms**

### Buildings / OSM

- raw elements: **5,704**
- source building candidates: **141**
- validated normalized footprints: **135**
- compiled footprints: **135**
- raw bytes: **1,053,121**
- runner raw SHA-256: `d14a6d75f8ab4ac98d0b299eefe301a4c81e3f4aa2ab91f1bfe8acde566e857f`
- artifact bytes: **80,846**
- artifact SHA-256: `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`
- acquire: **1092.599 ms**
- normalize + compile: **52.274 ms**
- persist: **0.664 ms**
- total: **1145.537 ms**

## Warm / offline compile

The second run used the persisted raw cache with source networking disabled.

- Roads: cache hit; **407 -> 246**; artifact SHA unchanged; total **148.363 ms**.
- Buildings: cache hit; **135 -> 135**; artifact SHA unchanged; total **63.811 ms**.
- Cold and warm raw SHA-256, feature counts and artifact SHA-256 values are identical per source snapshot.

This proves the vector compiler's cold-to-warm determinism for this Nannestad source snapshot and that an offline compiler run does not need NVDB/OSM contact after acquisition.

## Runtime verification

The emitted `RuntimeVerificationBundle` plus exact compiled bytes were passed to `engine/streaming/runtime_verifier.mjs`.

- road-network: `READY_FOR_RUNTIME` / `RUNTIME_VERIFICATION_PASS`
- building-footprints: `READY_FOR_RUNTIME` / `RUNTIME_VERIFICATION_PASS`

The proof workflow uploaded compiled artifacts, bundles, cold/warm reports and runtime-verification results. It intentionally did **not** upload the raw source cache.

## Current interpretation

This closes the execution-evidence gap for the Prototype-0 vector artifact vertical. It does **not** close building height enrichment, OSM multipolygon relations, exact physical road widths, authoritative DTM1 terrain, or a final runtime/format choice.

## Next

1. Feed these exact compiled road/building artifacts to the Nannestad visual harness with raw NVDB/OSM networking hard-disabled.
2. Measure browser artifact verify/decode/rebase/upload/first-visible/frame-time/draw calls on Android.
3. Continue the authoritative DTM1 raw -> normalized -> compiled terrain vertical so the same viewer can stop using the historical reference raster.
4. Once a terrain + vector render artifact exists, compare the custom viewer and Cesium baseline using the same compiled inputs before any renderer decision.
