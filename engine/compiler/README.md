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

The first normalizer is intentionally conservative: EPSG:25832, pixel-aligned window, no implicit resampling/reprojection, explicit NN2000 tag. A source needing warp/resampling must introduce a versioned TransformContract rather than silently changing data.

```bash
python -m pip install -e ./engine/compiler
nwe-normalize-dtm source.tif normalized.tif \
  --bounds 611000 6677000 612000 6678000 \
  --source-vertical-datum NN2000
```

## Tests

```bash
pytest -q engine/compiler/tests
```

The spatial regressions include the SENTINEL triangle whose bounding box covers Nannestad while the actual polygon does not. Bbox is only a prefilter; actual geometry is authoritative.
