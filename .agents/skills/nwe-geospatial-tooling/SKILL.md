---
name: nwe-geospatial-tooling
description: Routes NWE preprocessing to the pinned Rasterio/GDAL, pyproj/PROJ, Shapely and RFC8785 libraries instead of custom geospatial primitives. Use for raster, CRS, geometry and provenance work.
---

# NWE Geospatial Tooling

Use the versions declared in `engine/compiler/pyproject.toml`; do not silently change them.

- **Rasterio/GDAL**: raster metadata, windows, deterministic clips and raster I/O.
- **pyproj/PROJ**: CRS transforms. Use `always_xy=True` where the contract expects x/y and keep vertical datum separate from horizontal EPSG.
- **Shapely**: topology and exact spatial predicates. Bbox may prefilter but may not replace an actual polygon predicate.
- **rfc8785**: RFC 8785/JCS serialization before SHA-256. Do not recreate canonical JSON with ad-hoc `sort_keys` logic.

Prototype-0 DTM clipping must reject implicit reprojection/resampling. If either is required, create an explicit TransformContract with method/resampling/datum semantics and test it.

Validate any new source against `nwe-geodata-contracts`; validate adversarial behavior with `nwe-quality-gates`.
