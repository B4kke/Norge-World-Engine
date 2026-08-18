from __future__ import annotations

from dataclasses import asdict, dataclass


class ExtentCrosscheckError(RuntimeError):
    pass


@dataclass(frozen=True)
class ExtentCrosscheck:
    declared_bounds: tuple[float, float, float, float]
    catalog_bounds: tuple[float, float, float, float]
    declared_width_m: float
    declared_height_m: float
    catalog_width_m: float
    catalog_height_m: float
    declared_center_delta_x_m: float
    declared_center_delta_y_m: float
    declared_regular: bool
    catalog_regular: bool
    classification: str


def _extent_metrics(bounds: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    left, bottom, right, top = (float(value) for value in bounds)
    width = right - left
    height = top - bottom
    if width <= 0 or height <= 0:
        raise ExtentCrosscheckError("extent must have positive width and height")
    return width, height, (left + right) / 2.0, (bottom + top) / 2.0


def classify_declared_vs_catalog_extent(
    declared_bounds: tuple[float, float, float, float],
    catalog_bounds: tuple[float, float, float, float],
    *,
    nominal_route_size_m: float = 15_000.0,
    nominal_overlap_m: float = 10.0,
    tolerance_m: float = 0.25,
) -> dict:
    """Classify GeoRSS-vs-ImageServer extent evidence without creating seam authority.

    The 15 km route size is an externally documented provider fact. The 10 m
    overlap / 15,010 m buffered extent is only a tested diagnostic hypothesis.
    A regular ImageServer footprint may falsify the idea that a GeoRSS deviation
    reflects the raster edge, but it still cannot authorize clipping or source
    priority for downloadable GeoTIFFs.
    """

    if nominal_route_size_m <= 0 or nominal_overlap_m < 0 or tolerance_m < 0:
        raise ExtentCrosscheckError("invalid route/overlap/tolerance contract")

    declared_width, declared_height, declared_cx, declared_cy = _extent_metrics(declared_bounds)
    catalog_width, catalog_height, catalog_cx, catalog_cy = _extent_metrics(catalog_bounds)
    tested_buffered_size = nominal_route_size_m + nominal_overlap_m

    declared_regular = (
        abs(declared_width - tested_buffered_size) <= tolerance_m
        and abs(declared_height - tested_buffered_size) <= tolerance_m
    )
    catalog_regular = (
        abs(catalog_width - tested_buffered_size) <= tolerance_m
        and abs(catalog_height - tested_buffered_size) <= tolerance_m
    )

    if catalog_regular and not declared_regular:
        classification = "CATALOG_REGULAR_DECLARED_DEVIATES"
    elif catalog_regular and declared_regular:
        classification = "BOTH_REGULAR"
    elif not catalog_regular and declared_regular:
        classification = "DECLARED_REGULAR_CATALOG_DEVIATES"
    else:
        classification = "BOTH_DEVIATE"

    audit = ExtentCrosscheck(
        declared_bounds=tuple(float(value) for value in declared_bounds),
        catalog_bounds=tuple(float(value) for value in catalog_bounds),
        declared_width_m=declared_width,
        declared_height_m=declared_height,
        catalog_width_m=catalog_width,
        catalog_height_m=catalog_height,
        declared_center_delta_x_m=declared_cx - catalog_cx,
        declared_center_delta_y_m=declared_cy - catalog_cy,
        declared_regular=declared_regular,
        catalog_regular=catalog_regular,
        classification=classification,
    )
    return {
        "schema": "nwe.dtm1-declared-catalog-extent-crosscheck/0.1",
        "nominal_route_size_m": nominal_route_size_m,
        "tested_nominal_overlap_m": nominal_overlap_m,
        "tested_buffered_size_m": tested_buffered_size,
        "tolerance_m": tolerance_m,
        "audit": asdict(audit),
        "claim_calibration": {
            "fact": "declared GeoRSS and provider ImageServer catalog extents were compared",
            "inference": "catalog regularity can distinguish metadata-footprint deviation from catalog-footprint deviation",
            "not_proven": "catalog footprint equals downloadable GeoTIFF byte/raster bounds or defines overlap priority",
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
