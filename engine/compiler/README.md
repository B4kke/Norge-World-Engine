# World Compiler

Production-direction preprocessing from source snapshots to normalized and compiled runtime artifacts.

## Foundation

`pyproject.toml` pins the generic geospatial primitives NWE does not need to reimplement:

- Rasterio/GDAL — raster metadata, reads/writes and deterministic windows.
- pyproj/PROJ — CRS transforms.
- Shapely — topology and exact geometry predicates.
- rfc8785 — RFC 8785/JCS canonical serialization for provenance hashes.

The compiler still owns the NWE-specific contracts: Norwegian source identity/license, NN2000/Z semantics, deterministic tile/transform contracts, raw/normalized/compiled caches, lineage and promotion.

## Prototype-0 DTM normalizer

The first terrain normalizer is intentionally conservative: EPSG:25832, pixel-aligned window, no implicit resampling/reprojection, explicit NN2000 tag. A source needing warp/resampling must introduce a versioned TransformContract rather than silently changing data.

```bash
python -m pip install -e ./engine/compiler
nwe-normalize-dtm source.tif normalized.tif \
  --bounds 611000 6677000 612000 6678000 \
  --source-vertical-datum NN2000
```

## Prototype-0 vector vertical

`nwe-compile-vectors` owns source acquisition for the 1 × 1 km Nannestad proof. It derives source query envelopes from all four tile corners, SHA-256-addresses raw responses outside Git, normalizes into EPSG:25832 and emits content-addressed road/building artifacts plus RuntimeVerificationBundle lineage.

```bash
# Cold/source refresh. Requires network access.
nwe-compile-vectors --cache-root data --refresh

# Warm proof. This must succeed with source networking forbidden.
nwe-compile-vectors --cache-root data --offline
```

Expected cache boundaries:

```text
data/raw/<tile>/<source>/<raw-sha>.json
data/normalized/<tile>/<role>/<normalized-sha>.json
data/compiled/<tile>/<role>/<artifact-sha>.json
data/compiled/<tile>/<role>/<artifact-sha>.bundle.json
```

The command reports raw bytes/counts, normalized/compiled counts, artifact SHA-256/bytes, cache hit state and phase timings. Raw/normalized/compiled data remain gitignored.

Current Prototype-0 source contracts are documented in `docs/data-licenses/vector-sources.md`. They are not a whole-Norway acquisition decision.

## Tests

```bash
pytest -q engine/compiler/tests
node apps/world-viewer/test_artifact_consumer.mjs
```

The spatial regressions include the SENTINEL triangle whose bounding box covers Nannestad while the actual polygon does not. Vector regressions cover CRS/Z semantics, graph collapse, raw-cache cold/warm behavior, deterministic lineage-bound artifact construction and the browser rule that normal runtime performs zero raw NVDB/OSM requests.
