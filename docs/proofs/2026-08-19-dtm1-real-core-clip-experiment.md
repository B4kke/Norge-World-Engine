# FORGE proof — real Nannestad DTM1 core-clip experiment

**Date:** 2026-08-19  
**Gate:** `P0-MULTITILE-TERRAIN-01`  
**Evidence class:** exact SHA-addressed real DTM1 source measurement + deterministic seam sweep. Diagnostic only; not production seam authority.

## Question

The provider-side evidence gives a nominal 15 km DTM1 domain while the accepted Nannestad Atom rasters are measured as 15,010 x 15,010 pixels at 1 m. That geometry yields a unique centered 5 px-per-side core candidate, but provider documentation has not yet stated that the ten excess metres are disposable buffer/halo/overscan.

This experiment asks a narrower empirical question: if every integer seam location through the real 10 m overlap is evaluated, does the symmetric 5/5 candidate stand out as the smoothest continuation?

A positive result would still not establish authority. A negative result would rule out using smoothness as an independent justification for the 5/5 candidate.

## Exact real sources

Hosted run `32246511405` acquired the exact current Nannestad source pair through the normal DTM1 source-pool path:

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

## Integer seam sweep

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

## Interpretation

This is useful negative evidence.

The centered 5 px candidate remains the unique transform that converts the measured 15,010 px source geometry to the provider's nominal 15,000 m domain. But the actual terrain values do **not** independently select that candidate by local seam smoothness. An unconstrained “choose the smoothest seam” heuristic would select 3/7 instead, for which there is no provider-owned semantic justification.

Therefore neither smoothness, visual continuity nor this ranking may be used as source authority. The experiment strengthens the requirement that production promotion depends on provider-owned meaning for the ten excess source metres rather than on an optimization metric fitted to this seam.

Current claim calibration:

- `symmetric_5px_geometry_candidate=true`;
- `symmetric_candidate_best_by_discontinuity_p95=false`;
- `diagnostic_metric_authorizes_transform=false`;
- `production_seam_authority=false`;
- `authority_status=UNPROVEN`.

## Validation and hygiene

PR merge-ref workflow `dtm1-core-clip-experiment` run `32246511405` completed successfully. Focused regressions: **4 passed**.

Evidence artifact:

- artifact ID: `9362825264`;
- uploaded size: `10,121 B`;
- ZIP SHA-256: `527dbec329695e21d61f411a455b5ddcd22f7ee9475cdc878e938fa7ddeb8f40`;
- contents: JSON diagnostics only.

The workflow removes the downloaded ~2.2 GB of TIFF source data before evidence upload and explicitly rejects `.tif`, `.tiff`, `.las` and `.laz` files from the proof directory.

On synchronized FORGE head `a3ca216f931c40cfa8cc8556921a153a95d47e79`, the following PR workflows completed successfully: repository `baseline` `32246511373`, `dtm1-multitile-source-plan` `32246511426`, `dtm1-nannestad-project-lineage` `32246511420`, `dtm1-provider-edge-domain` `32246511386`, `dtm1-nhm-generation-distribution-bridge` `32246511427`, `dtm1-nhm-update-scope` `32246511443`, `dtm1-core-clip-experiment` `32246511405`, and `preview1-realdata-publish` `32246511383`.

## Decision boundary

`docs/04-decisions.md` is intentionally unchanged. No production seam transform is proved.

`P0-MULTITILE-TERRAIN-01` remains **FAIL CLOSED**. Do not promote 3/7 because it scores best, and do not promote 5/5 merely because it matches the nominal geometry. The missing evidence remains a provider-owned, DTM1-source-family-bound statement that defines ownership or treatment of the ten excess source metres.
