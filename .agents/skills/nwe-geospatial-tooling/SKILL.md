---
name: nwe-geospatial-tooling
description: Routes NWE preprocessing to pinned Rasterio/GDAL, pyproj/PROJ, Shapely and RFC8785 primitives while preserving explicit transforms, source tiling and deterministic provenance.
---

# NWE Geospatial Tooling

Use versions declared by the repository; do not silently upgrade dependencies inside feature work.

- **Rasterio/GDAL**: raster metadata, windows, deterministic I/O, explicit reprojection/resampling and mosaicking.
- **pyproj/PROJ**: CRS transforms. Use `always_xy=True` where contracts expect x/y and keep vertical datum semantics separate from horizontal EPSG.
- **Shapely**: topology and exact predicates. Bounding boxes may prefilter but cannot replace geometry authority.
- **rfc8785**: RFC 8785/JCS serialization before SHA-256. Do not recreate canonical JSON with ad-hoc key sorting.

The accepted Nannestad DTM1 transform explicitly maps EPSG:25833 source data to a fixed EPSG:25832 + NN2000 1 m runtime grid with bilinear resampling. Treat that as a versioned Prototype-0 transform, not a generic default.

When one runtime tile intersects multiple provider tiles, preserve plural source identities. Never hide overlap resolution in library ordering. Any seam/mosaic choice affecting values is an explicit transform/configuration and needs adversarial tests plus provenance.

Validate new sources via `nwe-geodata-contracts` and failure behavior via `nwe-quality-gates`.
