from __future__ import annotations

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
    pixel_size_x_m: float
    pixel_size_y_m: float
    raster_matches_catalog: bool
    raster_matches_declared: bool
    classification: str


def _bounds_tuple(bounds: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    values = tuple(float(value) for value in bounds)
    left, bottom, right, top = values
    if right <= left or top <= bottom:
        raise RasterGridCrosscheckError("bounds must have positive width and height")
    return values


def _matches(a: tuple[float, float, float, float], b: tuple[float, float, float, float], tolerance_m: float) -> bool:
    return all(abs(left - right) <= tolerance_m for left, right in zip(a, b, strict=True))


def classify_raster_grid(
    *,
    raster_bounds: tuple[float, float, float, float],
    declared_bounds: tuple[float, float, float, float],
    catalog_bounds: tuple[float, float, float, float],
    raster_width_px: int,
    raster_height_px: int,
    pixel_size_x_m: float,
    pixel_size_y_m: float,
    expected_crs: str,
    observed_crs: str | None,
    tolerance_m: float = 0.25,
    expected_pixel_size_m: float = 1.0,
    pixel_tolerance_m: float = 1e-6,
) -> dict:
    """Compare actual raster grid metadata to provider metadata surfaces.

    This is diagnostic evidence only. Matching raster and catalog bounds can reject
    GeoRSS as a precise raster-edge authority, but it cannot authorize clipping,
    sample priority or any production seam rule.
    """

    if raster_width_px <= 0 or raster_height_px <= 0:
        raise RasterGridCrosscheckError("raster dimensions must be positive")
    if tolerance_m < 0 or pixel_tolerance_m < 0 or expected_pixel_size_m <= 0:
        raise RasterGridCrosscheckError("invalid tolerance/pixel-size contract")
    if observed_crs != expected_crs:
        raise RasterGridCrosscheckError(f"unexpected raster CRS: {observed_crs!r}; expected {expected_crs!r}")
    if abs(abs(float(pixel_size_x_m)) - expected_pixel_size_m) > pixel_tolerance_m:
        raise RasterGridCrosscheckError("unexpected raster x pixel size")
    if abs(abs(float(pixel_size_y_m)) - expected_pixel_size_m) > pixel_tolerance_m:
        raise RasterGridCrosscheckError("unexpected raster y pixel size")

    raster = _bounds_tuple(raster_bounds)
    declared = _bounds_tuple(declared_bounds)
    catalog = _bounds_tuple(catalog_bounds)
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
        pixel_size_x_m=float(pixel_size_x_m),
        pixel_size_y_m=float(pixel_size_y_m),
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
            "fact": "actual raster grid metadata was compared with declared GeoRSS and ImageServer catalog extents",
            "inference": "matching grid geometry can identify which metadata surface reproduces actual raster bounds",
            "not_proven": "matching bounds define a disposable halo, source priority, seam winner or production transform",
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
