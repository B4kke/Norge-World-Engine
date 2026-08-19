# FORGE proof — direct NHM WCS 3×3 terrain promotion

Date: 2026-08-19  
Gate: `P0-MULTITILE-TERRAIN-01`  
Role: FORGE  
Integration owner: SENTINEL

## Conclusion

The Nannestad multi-tile terrain blocker can be removed without inventing an ownership rule for the overlapping 15 km Atom GeoTIFF packaging.

For Prototype 0 / the tested UTM32 area, the World Compiler can acquire the official Kartverket **NHM DTM 25832 WCS** directly on NWE's exact 1 km runtime tile grid, bind each exact GetCoverage response as a `SourceSnapshot`, validate/decode the already-aligned 1 m grid with **no reprojection and no resampling**, compile `nwe.terrain-height-grid-artifact/0.1`, and reproduce the same source/normalized/artifact/provenance identities with source networking disabled.

Hosted proof produced nine independently identified real terrain artifacts. All nine passed `engine/streaming/runtime_verifier.mjs` as:

- `READY_FOR_RUNTIME`
- `RUNTIME_VERIFICATION_PASS`

This is a deliberate source-path change from the historical single-tile Atom proof. The accepted D-007 Atom artifact remains valid evidence for that source/transform, but the WCS-derived center artifact is intentionally a different immutable artifact identity.

## Why the 5 px buffer hypothesis was not promoted

The preceding controlled real-overlap experiment tested the exact DTM1 Atom pair:

- `33-125-116.tif`
- `33-125-117.tif`

Both are 15,010 × 15,010 at 1 m and overlap by 10 m. Every integer ownership boundary through the overlap was tested.

The geometrically symmetric `5/5` core clip:

- was physically plausible and did not create a catastrophic terrain wall;
- ranked **11/11** on the local slope-adjusted seam-continuity metric;
- ranked **6/11** against Kartverket's seamless 1 m WCS QA surface;
- was not corroborated as the provider's actual ownership rule.

The local-continuity best candidate and WCS best candidate also disagreed. Selecting `3/7`, `10/0`, `5/5`, newest, first, mean, tolerance or file order from those diagnostics would therefore convert measurement into invented world truth.

Proof: `docs/proofs/2026-08-19-dtm1-real-core-clip-experiment.md`.

## Official WCS source contract

Source service:

- endpoint: `https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25832`
- coverage: `nhm_dtm_topo_25832`
- WCS protocol: 1.0.0
- Kartverket/Geonorge service metadata UUID: `05821c51-2f5b-411f-9098-924d13dbea9a`
- Data Norge service record: `https://data.norge.no/nb/data-services/1dc55424-6762-3c51-a705-6034c79b8b48`
- current service role: download service for the national digital height/terrain model, supporting 1 m output in EUREF89 / UTM zone 32 for the documented coverage area.

License / attribution:

- Kartverket current terms: `https://www.kartverket.no/api-og-data/vilkar-for-bruk`
- Kartverket free/open products are licensed under **CC BY 4.0**;
- attribution encoded by the compiler: `© Kartverket`.

Vertical semantics:

- source family: NHM/FvL terrain heights;
- compiler contract: `NN2000`, `z_semantics=normal_height_m`;
- the individual WCS GeoTIFF response does not independently advertise a compound vertical CRS, so the datum binding remains explicitly attributed to the official FvL/Punktsky source-family contract rather than inferred from an anonymous raster Z.

Scope limitation:

- this decision is for Prototype-0 Nannestad / the tested UTM32 WCS coverage;
- it does **not** establish a whole-Norway UTM-zone/source strategy;
- WCS service limits, coverage and neighboring zone strategy remain later whole-Norway work.

## Compiler implementation

### Acquisition

`engine/compiler/src/nwe_compiler/nhm_wcs_acquisition.py`

Each 1 km tile acquisition binds:

- exact GetCoverage URL and BBOX;
- `EPSG:25832` request/response CRS;
- exact 1000 × 1000 / 1 m request grid;
- coverage and service identity;
- current GetCapabilities SHA-256;
- current DescribeCoverage SHA-256;
- exact raw GeoTIFF byte SHA-256 and byte size;
- validated raster bounds, pixel size, type, nodata and full valid-sample coverage;
- CC BY 4.0 license profile and Kartverket attribution.

Raw responses are content-addressed outside Git. Offline mode fails closed on a missing/corrupt cache object.

### Transform

`engine/compiler/src/nwe_compiler/nhm_wcs_terrain_artifacts.py`

Transform operation:

`nhm-wcs-direct-grid-validate-decode-float32-no-resampling`

Properties:

- source CRS = `EPSG:25832`;
- target CRS = `EPSG:25832`;
- vertical operation = `identity-NN2000`;
- resampling = `none`;
- exact requested runtime tile bounds;
- 1000 × 1000 samples at 1 m;
- normalized representation = canonical little-endian Float32 height bytes.

GeoTIFF container bytes are therefore raw-source identity, not normalized/runtime identity. A regression proves that two differently encoded TIFF containers containing the same accepted elevation grid produce different raw SourceSnapshot identities but the same normalized bytes and terrain artifact; lineage still differs because raw provenance differs.

### Provenance / artifact

For every tile the compiler emits and runtime reconstructs:

`SourceSnapshot -> TransformContract -> NormalizedSnapshot -> CompilerConfig -> CompileLineage -> ArtifactRef -> PromotionRecord`

Artifact status is `REAL_COMPILED`. Runtime artifact schema remains the already accepted `nwe.terrain-height-grid-artifact/0.1`; no renderer-specific format decision is introduced.

## Exact hosted promotion proof

Workflow:

- `nhm-wcs-3x3-promotion-proof`
- successful run: `32249306249`
- job: `96056560631`
- code head: `8e5e5f77d53896a3134965663bf042e9c64ea5b7`
- PR merge ref tested against then-current main: `fe1bc1691d3cdea820bde41edeba6884f09c6884`

Regression result:

- `2 passed` for the WCS production acquisition/compile/offline path.

Cold run:

- 9 runtime tiles;
- exactly 11 provider requests:
  - 2 shared service metadata requests (`GetCapabilities`, `DescribeCoverage`);
  - 9 exact 1 km `GetCoverage` requests;
- each raw GetCoverage response: 4,195,950 B;
- each normalized grid: exactly 4,000,000 B / 1,000,000 Float32 samples;
- all outputs are exact EPSG:25832, 1 m, 1000 × 1000 and contain 1,000,000 valid samples.

Offline repeat:

- provider/source requests: **0**;
- all nine raw source SHA-256 identities equal the cold run;
- all nine normalized SHA-256 identities equal the cold run;
- all nine artifact SHA-256 identities equal the cold run;
- all nine PromotionRecord identities equal the cold run.

Runtime:

- **9/9 `READY_FOR_RUNTIME`**;
- **9/9 `RUNTIME_VERIFICATION_PASS`**;
- verifier reconstructed every source, transform, normalized snapshot, compiler config, lineage, artifact ref and promotion record rather than trusting producer PASS flags.

Timing observation on the successful hosted run:

- cold acquire + compile + persist, 9 tiles: **19,904.646 ms**;
- source-network-free offline validate + compile, 9 tiles: **484.608 ms**.

These are workflow observations, not general performance guarantees.

## Exact artifact identities

| Runtime tile | Artifact SHA-256 |
|---|---|
| `epsg25832_610000_6676000_1000m` | `f43201b3b3138c6eeafd3d03c5c16fce69cd0ffc54e7737fd11110009b572789` |
| `epsg25832_610000_6677000_1000m` | `a18805dc506e21810df43a81b802d4d24d44c99fdd3085dddbaa3297d0d2e25a` |
| `epsg25832_610000_6678000_1000m` | `7e8f889294f3d947f7678449b13f7001d4580730b3dc1b10ce2249c6e97c1295` |
| `epsg25832_611000_6676000_1000m` | `ad0c3ae7c4f9efba0b1d253a5a235043f4b79f679281aea6949f0f26729647c3` |
| `epsg25832_611000_6677000_1000m` | `a0f6107ce9497a9e7221aa06a7b590cb9b8b2958ac316c32ef79059e604b052e` |
| `epsg25832_611000_6678000_1000m` | `5d6fb6389bee43688fb232af939c0c5e813d09f29daca897364257f5b9da5ddc` |
| `epsg25832_612000_6676000_1000m` | `0ca537b0e58dd40edaecde2b9f4b627ce837328d03d0db6c56f655520096e18b` |
| `epsg25832_612000_6677000_1000m` | `dca40fff170ae4fdfe108581d8317ddf2b7287865cd83373e54e3f05672f497a` |
| `epsg25832_612000_6678000_1000m` | `a9930882cf6b48d873fe842ce3932aae2f03f83dd9a6eb16e3283284e19be227` |

Service evidence digests in this run:

- GetCapabilities SHA-256: `30045563eadd52409e50b1f76c3692fe1d99ef43268e10574c5622a0e38ada68`;
- DescribeCoverage SHA-256: `8d320111a5b409d02270027f14e1dedf61338de3422100a553284b8c0569ba86`.

## Direct 3×3 seam evidence

Before promotion, an isolated source-candidate workflow fetched all nine exact WCS runtime grids twice and analyzed all **12 internal 1 km tile boundaries**.

Across those seams, cross-boundary p95 1 m slope relative to same-tile local 1 m slope was:

- median ratio: `0.959392671207258`;
- p95 ratio: `1.041478522102473`;
- max ratio: `1.083417588467891`.

Slope-adjusted seam-discontinuity p95 across the 12 boundaries was:

- median `0.06836566925048827 m`;
- p95 `0.09969757080078119 m`;
- max `0.12445831298828122 m`.

The direct 1 km WCS tiles therefore show ordinary local terrain-step behavior rather than the artificial source-ownership ambiguity encountered in the overlapping 15 km Atom packaging.

Source-candidate run:

- workflow: `nhm-wcs-3x3-source-candidate`;
- run: `32248273723`;
- 9 first-live grids, 9 repeated-live grids and offline replay were grid-hash identical;
- 12/12 internal seams measured;
- first live transfer: 37,763,550 B total (~4.196 MB per runtime tile).

## Center-tile transition is intentional

Historical D-007 Atom-derived center artifact:

`780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`

New direct-WCS center artifact:

`a0f6107ce9497a9e7221aa06a7b590cb9b8b2958ac316c32ef79059e604b052e`

They are **not byte-identical**. This is not hidden nondeterminism: the source and transform contracts changed deliberately.

The prior multi-tile acceptance condition “center tile unchanged” applied to attempts to extend the D-007 Atom source path. It must not be used to pretend a deliberately different authoritative source path is the same immutable artifact. D-007 remains historical evidence for the accepted Atom transform; the direct-WCS multi-tile path receives its own decision and lineage.

## Evidence artifact / hygiene

Successful workflow artifact:

- artifact ID: `9363804609`;
- ZIP SHA-256: `eeb767067db95fc7dd4cf00b35df9237a59a7764fdae17220355befc75767e37`;
- uploaded size: 28,375,111 B;
- retention: 7 days;
- contents: 9 compiled `.nwehgt` artifacts, 9 RuntimeVerificationBundle JSON files, promotion proof JSON and runtime verification JSON.

Before upload the workflow removes:

- raw WCS GeoTIFFs;
- normalized `.f32le` grids;
- all cache/source data.

No raw WCS/Atom TIFF, LAS/LAZ, cache, credential or source secret is committed to the repository or evidence upload.

## Claim calibration

### Proven for Prototype-0 Nannestad multi-tile terrain

- exact 1 km × 1 km official WCS acquisition aligned to the runtime grid;
- explicit source/license/service/request identity;
- no source mosaic or overlap winner is invented by NWE;
- no reprojection/resampling in the WCS transform path;
- deterministic canonical normalized elevation bytes;
- deterministic real compiled artifacts;
- source-network-free offline repeat;
- 9/9 runtime provenance verification;
- clean measured 12-seam 3×3 runtime grid.

### Not proven

- whole-Norway WCS/UTM-zone source strategy;
- that WCS is the final whole-Norway terrain acquisition mechanism;
- final terrain mesh/LOD format;
- service throughput suitable for bulk national compilation without provider-aware throttling/cache/prefetch policy;
- replacement of the historical D-007 proof as evidence of the Atom path itself.

## Result

For the Nannestad Prototype-0 multi-tile compiler, the unresolved 15,010/15,000 Atom overlap no longer needs a guessed production seam transform. The production-direction source path can request the provider's national terrain surface on NWE's exact 1 km EPSG:25832 grid and bind those responses directly into the existing provenance/runtime-artifact model.

**FORGE gate result:** `P0-MULTITILE-TERRAIN-01 = FORGE PASS / READY FOR SENTINEL INTEGRATION`.

This is not yet a statement that the PR is merged to `main`; SENTINEL still owns integration/review.
