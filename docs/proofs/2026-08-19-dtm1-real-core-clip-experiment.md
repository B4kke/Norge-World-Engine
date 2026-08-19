# FORGE proof — real Nannestad DTM1 core-clip experiment

**Date:** 2026-08-19  
**Gate:** `P0-MULTITILE-TERRAIN-01`  
**Evidence class:** exact SHA-addressed real DTM1 source measurement + deterministic seam sweep + independent provider WCS diagnostic. Diagnostic only; not production seam authority.

## Question

The provider-side evidence gives a nominal 15 km DTM1 domain while the accepted Nannestad Atom rasters are measured as 15,010 x 15,010 pixels at 1 m. That geometry yields a unique centered 5 px-per-side core candidate, but provider documentation has not yet stated that the ten excess metres are disposable buffer/halo/overscan.

This experiment asks two narrower empirical questions:

1. if every integer seam location through the real 10 m overlap is evaluated, does the symmetric 5/5 candidate stand out as the smoothest continuation?;
2. does an independent provider WCS surface select the same 5/5 candidate when all eleven integer splits are compared against it?

A positive result would still not establish authority. A negative result rules out using the diagnostic as an independent justification for 5/5.

## Exact real sources

Hosted runs acquired the exact current Nannestad source pair through the normal DTM1 source-pool path:

- `33-125-116.tif`: 1,138,369,015 B; SHA-256 `7421aa6c6c8a6aa166b8a088a82819f2a9c765b78d3103800196081fd5e5c3ce`;
- `33-125-117.tif`: 1,096,856,487 B; SHA-256 `f1c0f18378cc438d7e4b8f8a2114c4e5aa000216a4fd42965518df9a0bb97708`.

Both are 15,010 x 15,010. The common north/south overlap is 10 m high and 15,010 pixels wide in EPSG:25833, with bounds `[275425, 6680995, 290435, 6681005]`.

## Raw overlap truth

The overlap contains 150,100 valid paired samples. 150,030 differ and only 70 are exactly equal, so the differing fraction is `0.9995336442371752`.

Absolute source-to-source height delta:

- mean: `0.026306479070918865 m`;
- p50: `0.0113525390625 m`;
- p90: `0.06030426025390634 m`;
- p95: `0.0940093994140625 m`;
- p99: `0.27413955688476577 m`;
- max: `1.2039642333984375 m`.

The maximum measured difference is at EPSG:25833 `(284255.5, 6681003.5)`, where source A is `211.45216369628906 m` and source B is `212.6561279296875 m`.

## Integer seam sweep — local continuity

The diagnostic evaluates all eleven integer trim pairs whose sum equals the measured 10 m overlap. Ranking is by p95 absolute cross-source discontinuity after subtracting local one-metre slope on each side.

The best candidate is **3/7**, not 5/5:

1. 3/7 — p95 `0.13510322570800778 m`;
2. 7/3 — p95 `0.1352943420410156 m`;
3. 2/8 — p95 `0.13623886108398436 m`;
4. 10/0 — p95 `0.1373424530029296 m`;
5. 1/9 — p95 `0.13740577697753906 m`;
6. 0/10 — p95 `0.13769989013671857 m`;
7. 9/1 — p95 `0.13872146606445307 m`;
8. 8/2 — p95 `0.13930702209472653 m`;
9. 4/6 — p95 `0.13978996276855452 m`;
10. 6/4 — p95 `0.143918991088867 m`;
11. **5/5 — p95 `0.14408111572265625 m`**.

The symmetric 5/5 candidate therefore ranks **11/11** on this diagnostic. Its cross one-metre step has absolute p95 `0.37072982788085934 m`; its slope-adjusted discontinuity has absolute p95 `0.14408111572265625 m`.

Even compared only with the two extreme rules that keep one source through the full overlap, 5/5 is not better: the best extreme has p95 `0.1373424530029296 m`, while 5/5 is about 4.9% worse under this diagnostic.

## Independent provider WCS crosscheck

Hosted `dtm1-core-clip-experiment` run `32246950961` additionally queried the provider WCS only as an independent QA sensor. It did **not** replace the SHA-addressed Atom GeoTIFFs as source authority.

WCS surface:

- endpoint: `https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25832`;
- coverage: `nhm_dtm_topo_25832`;
- diagnostic GetCoverage: 1000 x 1000 at 1 m in EPSG:25832;
- GetCoverage bytes: `4,195,950`;
- GetCoverage SHA-256: `f8a8fd5aad4125c1c75b18aa6ec3d8e00bf319cfd76ec8e9e0ad6fadfcb92f48`.

All eleven integer seam splits were transformed into the WCS diagnostic tile and ranked by overlap-band RMSE against the WCS surface. The best candidate was **10/0**, not 5/5: it keeps the upper/right source through the complete 10 m raw overlap and places the seam at EPSG:25833 northing `6680995`.

Best 10/0 candidate:

- overlap RMSE: `0.2137522536 m`;
- overlap MAE: `0.0762269848 m`;
- full diagnostic-tile RMSE: `0.1018375531 m`.

Symmetric 5/5:

- rank by WCS overlap RMSE: **6/11**;
- overlap RMSE: `0.2147038105 m`;
- overlap MAE: `0.0776008095 m`;
- RMSE delta from best: about `0.000951557 m`.

The difference is small, so it would be especially unsafe to promote 10/0 as truth from this metric. The relevant result is instead that the independent provider WCS does **not** uniquely corroborate the symmetric 5/5 candidate.

The two diagnostics disagree with each other as well: local smoothness prefers 3/7, while WCS similarity prefers 10/0. That disagreement is evidence against metric-driven seam selection and strengthens fail-closed behavior.

## Interpretation

This is useful negative evidence.

The centered 5 px candidate remains the unique transform that converts the measured 15,010 px source geometry to the provider's nominal 15,000 m domain. But the actual terrain values do **not** independently select that candidate by local seam smoothness, and the independent provider WCS does not select it either.

An unconstrained optimization heuristic would therefore choose different rules depending on the diagnostic: 3/7 for local continuity or 10/0 for WCS similarity. Neither has provider-owned DTM1 border semantics. Smoothness, visual continuity, WCS similarity and best-fit metrics must remain QA signals rather than source authority.

Current claim calibration:

- `symmetric_5px_geometry_candidate=true`;
- `symmetric_candidate_best_by_discontinuity_p95=false`;
- `symmetric_candidate_best_by_provider_wcs_rmse=false`;
- `diagnostic_metrics_agree=false`;
- `diagnostic_metric_authorizes_transform=false`;
- `wcs_can_promote_source_authority=false`;
- `production_seam_authority=false`;
- `authority_status=UNPROVEN`.

## Validation and hygiene

The first real-source sweep was proven by run `32246511405`. The expanded WCS crosscheck was proven by run `32246950961`. In the expanded run, the focused experiment suite completed with **7 passed**.

Expanded evidence artifact:

- artifact ID: `9363003886`;
- uploaded size: `16,068 B`;
- ZIP SHA-256: `1e2224c45d42c1f1d4b15b3de946d4ebe49f3dfaf40ea4bfbad9ceb63d1d50c3`;
- contents: JSON diagnostics only.

The workflow deletes the downloaded ~2.2 GB of TIFF source data before evidence upload and explicitly rejects `.tif`, `.tiff`, `.las` and `.laz` files from the proof directory.

On experiment head `91305998ecb3a2716577645bb9e83991c9090b9a`, repository `baseline`, `dtm1-multitile-source-plan`, `dtm1-nannestad-project-lineage`, `dtm1-provider-edge-domain`, `dtm1-nhm-generation-distribution-bridge`, `dtm1-nhm-update-scope`, `dtm1-core-clip-experiment`, and `preview1-realdata-publish` all completed successfully.

## Decision boundary

`docs/04-decisions.md` is intentionally unchanged. No production seam transform is proved.

`P0-MULTITILE-TERRAIN-01` remains **FAIL CLOSED**. Do not promote 3/7 because it scores best locally, 10/0 because it scores best against WCS, or 5/5 merely because it matches the nominal geometry. The missing evidence remains a provider-owned, DTM1-source-family-bound statement that defines ownership or treatment of the ten excess source metres.
