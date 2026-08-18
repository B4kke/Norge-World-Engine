from __future__ import annotations

import math
from dataclasses import asdict, dataclass


class RasterGridCrosscheckError(RuntimeError):
    pass


@dataclass(frozen=True)
class RasterGridCrosscheck:
    raster_bounds: tuple[float, float, float, float]
    declared_bounds: tuple[float, float, float, float]
    catalog_bounds: tuple[float, float, float, float]
    raster_width_px: int
    raster_height_px: int
    raster_transform: tuple[float, float, float, float, float, float]
    pixel_size_x_m: float
    pixel_size_y_m: float
    raster_matches_catalog: bool
    raster_matches_declared: bool
    classification: str


def _finite_tuple(values, *, size: int, label: str) -> tuple[float, ...]:
    converted = tuple(float(value) for value in values)
    if len(converted) != size or not all(math.isfinite(value) for value in converted):
        raise RasterGridCrosscheckError(f"{label} must contain {size} finite values")
    return converted


def _bounds_tuple(bounds: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    values = _finite_tuple(bounds, size=4, label="bounds")
    left, bottom, right, top = values
    if right <= left or top <= bottom:
        raise RasterGridCrosscheckError("bounds must have positive width and height")
    return values


def _matches(a: tuple[float, ...], b: tuple[float, ...], tolerance_m: float) -> bool:
    return all(abs(left - right) <= tolerance_m for left, right in zip(a, b, strict=True))


def classify_raster_grid(
    *,
    raster_bounds: tuple[float, float, float, float],
    declared_bounds: tuple[float, float, float, float],
    catalog_bounds: tuple[float, float, float, float],
    raster_width_px: int,
    raster_height_px: int,
    raster_transform: tuple[float, float, float, float, float, float],
    pixel_size_x_m: float,
    pixel_size_y_m: float,
    expected_crs: str,
    observed_crs: str | None,
    tolerance_m: float = 0.25,
    expected_pixel_size_m: float = 1.0,
    pixel_tolerance_m: float = 1e-6,
) -> dict:
    """Compare actual raster grid metadata to provider metadata extents.

    This is diagnostic evidence only. A valid observation must be a finite,
    north-up, axis-aligned raster grid whose affine transform, dimensions and
    reported bounds agree. Matching raster and catalog bounding extents can
    reject GeoRSS as a precise raster-edge authority, but it cannot authorize
    clipping, sample priority or any production seam rule.
    """

    if raster_width_px <= 0 or raster_height_px <= 0:
        raise RasterGridCrosscheckError("raster dimensions must be positive")
    if (
        not math.isfinite(float(tolerance_m))
        or not math.isfinite(float(pixel_tolerance_m))
        or not math.isfinite(float(expected_pixel_size_m))
        or tolerance_m < 0
        or pixel_tolerance_m < 0
        or expected_pixel_size_m <= 0
    ):
        raise RasterGridCrosscheckError("invalid tolerance/pixel-size contract")
    if observed_crs != expected_crs:
        raise RasterGridCrosscheckError(f"unexpected raster CRS: {observed_crs!r}; expected {expected_crs!r}")

    pixel_x = float(pixel_size_x_m)
    pixel_y = float(pixel_size_y_m)
    if not math.isfinite(pixel_x) or abs(pixel_x - expected_pixel_size_m) > pixel_tolerance_m:
        raise RasterGridCrosscheckError("unexpected raster x pixel size/orientation")
    if not math.isfinite(pixel_y) or abs(pixel_y + expected_pixel_size_m) > pixel_tolerance_m:
        raise RasterGridCrosscheckError("unexpected raster y pixel size/orientation")

    transform = _finite_tuple(raster_transform, size=6, label="raster transform")
    a, b, c, d, e, f = transform
    if abs(a - pixel_x) > pixel_tolerance_m or abs(e - pixel_y) > pixel_tolerance_m:
        raise RasterGridCrosscheckError("raster transform disagrees with reported pixel size")
    if abs(b) > pixel_tolerance_m or abs(d) > pixel_tolerance_m:
        raise RasterGridCrosscheckError("unexpected raster rotation/shear")

    raster = _bounds_tuple(raster_bounds)
    declared = _bounds_tuple(declared_bounds)
    catalog = _bounds_tuple(catalog_bounds)
    affine_bounds = (
        c,
        f + e * raster_height_px,
        c + a * raster_width_px,
        f,
    )
    if not _matches(raster, affine_bounds, tolerance_m):
        raise RasterGridCrosscheckError("raster bounds disagree with affine transform and dimensions")

    matches_catalog = _matches(raster, catalog, tolerance_m)
    matches_declared = _matches(raster, declared, tolerance_m)

    if matches_catalog and not matches_declared:
        classification = "RASTER_MATCHES_CATALOG_NOT_DECLARED"
    elif matches_catalog and matches_declared:
        classification = "RASTER_MATCHES_BOTH"
    elif not matches_catalog and matches_declared:
        classification = "RASTER_MATCHES_DECLARED_NOT_CATALOG"
    else:
        classification = "RASTER_MATCHES_NEITHER"

    audit = RasterGridCrosscheck(
        raster_bounds=raster,
        declared_bounds=declared,
        catalog_bounds=catalog,
        raster_width_px=int(raster_width_px),
        raster_height_px=int(raster_height_px),
        raster_transform=transform,
        pixel_size_x_m=pixel_x,
        pixel_size_y_m=pixel_y,
        raster_matches_catalog=matches_catalog,
        raster_matches_declared=matches_declared,
        classification=classification,
    )
    return {
        "schema": "nwe.dtm1-raster-grid-crosscheck/0.1",
        "tolerance_m": float(tolerance_m),
        "expected_crs": expected_crs,
        "expected_pixel_size_m": float(expected_pixel_size_m),
        "audit": asdict(audit),
        "claim_calibration": {
            "fact": "validated axis-aligned raster grid metadata was compared with declared GeoRSS and ImageServer catalog bounding extents",
            "inference": "matching grid geometry can identify which metadata bounding extent reproduces actual raster bounds",
            "not_proven": "catalog polygon equality, a disposable halo, source priority, seam winner or production transform",
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
