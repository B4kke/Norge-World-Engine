from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject

from nwe_compiler.seam_diagnostic import SeamDiagnosticError, analyze_raw_overlap


_EPS = 1e-3


def _quantiles(values: np.ndarray) -> dict[str, float]:
    values = np.asarray(values, dtype="float64")
    values = values[np.isfinite(values)]
    if values.size == 0:
        raise SeamDiagnosticError("cannot summarize empty seam metric")
    return {
        "min": float(np.min(values)),
        "p50": float(np.quantile(values, 0.50)),
        "p90": float(np.quantile(values, 0.90)),
        "p95": float(np.quantile(values, 0.95)),
        "p99": float(np.quantile(values, 0.99)),
        "max": float(np.max(values)),
        "mean": float(np.mean(values)),
    }


def _assert_source(dataset: rasterio.io.DatasetReader, label: str) -> None:
    if dataset.crs is None or dataset.crs.to_string() != "EPSG:25833":
        raise SeamDiagnosticError(f"{label}: expected EPSG:25833")
    if dataset.count != 1:
        raise SeamDiagnosticError(f"{label}: expected one raster band")
    if dataset.nodata is None:
        raise SeamDiagnosticError(f"{label}: explicit nodata is required")
    if abs(abs(dataset.transform.a) - 1.0) > 1e-6 or abs(abs(dataset.transform.e) - 1.0) > 1e-6:
        raise SeamDiagnosticError(f"{label}: expected 1 m pixels")
    if dataset.transform.b != 0 or dataset.transform.d != 0:
        raise SeamDiagnosticError(f"{label}: rotated/sheared grids are unsupported")


def _snap_metre(value: float, label: str) -> float:
    snapped = float(round(value))
    if abs(value - snapped) > _EPS:
        raise SeamDiagnosticError(f"{label} is not metre aligned: {value}")
    return snapped


def _read_strip(
    dataset: rasterio.io.DatasetReader,
    *,
    transform: Any,
    width: int,
    height: int,
) -> np.ndarray:
    out = np.full((height, width), np.nan, dtype="float32")
    reproject(
        source=rasterio.band(dataset, 1),
        destination=out,
        src_transform=dataset.transform,
        src_crs=dataset.crs,
        src_nodata=dataset.nodata,
        dst_transform=transform,
        dst_crs=dataset.crs,
        dst_nodata=np.nan,
        resampling=Resampling.nearest,
        num_threads=1,
        init_dest_nodata=True,
    )
    return out


def _candidate_metrics(
    *,
    lower_or_left: np.ndarray,
    upper_or_right: np.ndarray,
    axis: str,
) -> dict[str, Any]:
    if axis == "north_south":
        # top -> bottom rows: north-inner, north-edge, south-edge, south-inner
        north_inner = upper_or_right[0, :].astype("float64")
        north_edge = upper_or_right[1, :].astype("float64")
        south_edge = lower_or_left[2, :].astype("float64")
        south_inner = lower_or_left[3, :].astype("float64")
        valid = np.isfinite(north_inner) & np.isfinite(north_edge) & np.isfinite(south_edge) & np.isfinite(south_inner)
        cross = north_edge[valid] - south_edge[valid]
        lower_step = south_edge[valid] - south_inner[valid]
        upper_step = north_inner[valid] - north_edge[valid]
    else:
        # left -> right cols: west-inner, west-edge, east-edge, east-inner
        west_inner = lower_or_left[:, 0].astype("float64")
        west_edge = lower_or_left[:, 1].astype("float64")
        east_edge = upper_or_right[:, 2].astype("float64")
        east_inner = upper_or_right[:, 3].astype("float64")
        valid = np.isfinite(west_inner) & np.isfinite(west_edge) & np.isfinite(east_edge) & np.isfinite(east_inner)
        cross = east_edge[valid] - west_edge[valid]
        lower_step = west_edge[valid] - west_inner[valid]
        upper_step = east_inner[valid] - east_edge[valid]

    count = int(np.count_nonzero(valid))
    if count == 0:
        raise SeamDiagnosticError("candidate seam has no common valid edge samples")

    expected_local_step = (lower_step + upper_step) / 2.0
    discontinuity = cross - expected_local_step
    abs_discontinuity = np.abs(discontinuity)
    abs_cross = np.abs(cross)
    abs_lower = np.abs(lower_step)
    abs_upper = np.abs(upper_step)

    local_p95 = max(float(np.quantile(abs_lower, 0.95)), float(np.quantile(abs_upper, 0.95)))
    return {
        "valid_edge_samples": count,
        "cross_1m_step_m": {
            "signed": _quantiles(cross),
            "absolute": _quantiles(abs_cross),
        },
        "lower_or_left_internal_1m_step_m": {
            "signed": _quantiles(lower_step),
            "absolute": _quantiles(abs_lower),
        },
        "upper_or_right_internal_1m_step_m": {
            "signed": _quantiles(upper_step),
            "absolute": _quantiles(abs_upper),
        },
        "cross_discontinuity_after_local_slope_m": {
            "signed": _quantiles(discontinuity),
            "absolute": _quantiles(abs_discontinuity),
        },
        "cross_abs_p95_over_local_internal_abs_p95": (
            float(np.quantile(abs_cross, 0.95)) / local_p95 if local_p95 > 0 else None
        ),
    }


def _orientation(a: rasterio.io.DatasetReader, b: rasterio.io.DatasetReader) -> tuple[str, rasterio.io.DatasetReader, rasterio.io.DatasetReader]:
    ax = (a.bounds.left + a.bounds.right) / 2.0
    ay = (a.bounds.bottom + a.bounds.top) / 2.0
    bx = (b.bounds.left + b.bounds.right) / 2.0
    by = (b.bounds.bottom + b.bounds.top) / 2.0
    dx = abs(ax - bx)
    dy = abs(ay - by)
    if dy > dx:
        return ("north_south", a, b) if ay < by else ("north_south", b, a)
    if dx > dy:
        return ("east_west", a, b) if ax < bx else ("east_west", b, a)
    raise SeamDiagnosticError("cannot determine source adjacency orientation")


def analyze_core_clip_overlap(
    source_a: Path,
    source_b: Path,
    *,
    symmetric_inset_px: int = 5,
) -> dict[str, Any]:
    """Falsify/measure the symmetric DTM1 core-clip hypothesis on one real overlap.

    This is a diagnostic experiment, not a production seam authority. It sweeps
    every integer ownership boundary through the raw overlap and compares the
    5/5 symmetric split against the two extreme policies where one source keeps
    its complete overlapping edge.
    """
    if not isinstance(symmetric_inset_px, int) or isinstance(symmetric_inset_px, bool) or symmetric_inset_px < 0:
        raise SeamDiagnosticError("symmetric_inset_px must be a non-negative integer")

    raw_overlap = analyze_raw_overlap(source_a, source_b)

    with rasterio.open(source_a) as a, rasterio.open(source_b) as b:
        _assert_source(a, "source_a")
        _assert_source(b, "source_b")
        if a.crs != b.crs:
            raise SeamDiagnosticError("source CRS mismatch")
        axis, lower_or_left, upper_or_right = _orientation(a, b)

        if axis == "north_south":
            overlap_start = _snap_metre(max(a.bounds.bottom, b.bounds.bottom), "overlap bottom")
            overlap_end = _snap_metre(min(a.bounds.top, b.bounds.top), "overlap top")
            common_start = _snap_metre(
                max(a.bounds.left + symmetric_inset_px, b.bounds.left + symmetric_inset_px),
                "common core left",
            )
            common_end = _snap_metre(
                min(a.bounds.right - symmetric_inset_px, b.bounds.right - symmetric_inset_px),
                "common core right",
            )
            orthogonal_samples = int(round(common_end - common_start))
        else:
            overlap_start = _snap_metre(max(a.bounds.left, b.bounds.left), "overlap left")
            overlap_end = _snap_metre(min(a.bounds.right, b.bounds.right), "overlap right")
            common_start = _snap_metre(
                max(a.bounds.bottom + symmetric_inset_px, b.bounds.bottom + symmetric_inset_px),
                "common core bottom",
            )
            common_end = _snap_metre(
                min(a.bounds.top - symmetric_inset_px, b.bounds.top - symmetric_inset_px),
                "common core top",
            )
            orthogonal_samples = int(round(common_end - common_start))

        overlap_m = int(round(overlap_end - overlap_start))
        if overlap_m <= 0:
            raise SeamDiagnosticError("sources do not have a positive overlap")
        if orthogonal_samples <= 0:
            raise SeamDiagnosticError("symmetric inset removes the common seam span")
        if overlap_m != 2 * symmetric_inset_px:
            raise SeamDiagnosticError(
                f"raw overlap {overlap_m} m does not match 2 x symmetric inset {symmetric_inset_px} m"
            )

        candidates: list[dict[str, Any]] = []
        for offset in range(overlap_m + 1):
            seam = overlap_start + offset
            lower_trim = overlap_end - seam
            upper_trim = seam - overlap_start
            if axis == "north_south":
                transform = from_origin(common_start, seam + 2.0, 1.0, 1.0)
                width, height = orthogonal_samples, 4
            else:
                transform = from_origin(seam - 2.0, common_end, 1.0, 1.0)
                width, height = 4, orthogonal_samples
            lower_data = _read_strip(lower_or_left, transform=transform, width=width, height=height)
            upper_data = _read_strip(upper_or_right, transform=transform, width=width, height=height)
            metrics = _candidate_metrics(
                lower_or_left=lower_data,
                upper_or_right=upper_data,
                axis=axis,
            )
            candidates.append(
                {
                    "seam_coordinate_epsg25833": seam,
                    "lower_or_left_source_trim_m": lower_trim,
                    "upper_or_right_source_trim_m": upper_trim,
                    "symmetric": math.isclose(lower_trim, symmetric_inset_px) and math.isclose(upper_trim, symmetric_inset_px),
                    **metrics,
                }
            )

        ranking = sorted(
            candidates,
            key=lambda item: (
                item["cross_discontinuity_after_local_slope_m"]["absolute"]["p95"],
                item["cross_discontinuity_after_local_slope_m"]["absolute"]["mean"],
                item["seam_coordinate_epsg25833"],
            ),
        )
        for rank, item in enumerate(ranking, start=1):
            item["rank_by_discontinuity_p95"] = rank

        rank_by_coord = {item["seam_coordinate_epsg25833"]: item["rank_by_discontinuity_p95"] for item in ranking}
        for item in candidates:
            item["rank_by_discontinuity_p95"] = rank_by_coord[item["seam_coordinate_epsg25833"]]

        symmetric = next(item for item in candidates if item["symmetric"])
        extreme_lower_full = next(item for item in candidates if item["lower_or_left_source_trim_m"] == 0)
        extreme_upper_full = next(item for item in candidates if item["upper_or_right_source_trim_m"] == 0)
        sym_p95 = symmetric["cross_discontinuity_after_local_slope_m"]["absolute"]["p95"]
        best_extreme_p95 = min(
            extreme_lower_full["cross_discontinuity_after_local_slope_m"]["absolute"]["p95"],
            extreme_upper_full["cross_discontinuity_after_local_slope_m"]["absolute"]["p95"],
        )

        return {
            "schema": "nwe.dtm1-core-clip-overlap-experiment/0.1",
            "role": "diagnostic_only_not_production_seam_authority",
            "source_a": source_a.name,
            "source_b": source_b.name,
            "source_dimensions_px": {
                "a": [a.width, a.height],
                "b": [b.width, b.height],
            },
            "axis": axis,
            "raw_overlap_m": overlap_m,
            "raw_overlap": raw_overlap,
            "symmetric_inset_px": symmetric_inset_px,
            "symmetric_core_side_px_if_source_is_15010": 15010 - 2 * symmetric_inset_px,
            "common_seam_samples": orthogonal_samples,
            "candidate_count": len(candidates),
            "candidates": candidates,
            "ranking_by_discontinuity_p95": [
                {
                    "rank": item["rank_by_discontinuity_p95"],
                    "seam_coordinate_epsg25833": item["seam_coordinate_epsg25833"],
                    "lower_or_left_source_trim_m": item["lower_or_left_source_trim_m"],
                    "upper_or_right_source_trim_m": item["upper_or_right_source_trim_m"],
                    "symmetric": item["symmetric"],
                    "discontinuity_abs_p95_m": item["cross_discontinuity_after_local_slope_m"]["absolute"]["p95"],
                    "discontinuity_abs_mean_m": item["cross_discontinuity_after_local_slope_m"]["absolute"]["mean"],
                }
                for item in ranking
            ],
            "symmetric_candidate": symmetric,
            "extreme_keep_lower_or_left_full_edge": extreme_lower_full,
            "extreme_keep_upper_or_right_full_edge": extreme_upper_full,
            "symmetric_vs_best_extreme": {
                "symmetric_discontinuity_abs_p95_m": sym_p95,
                "best_extreme_discontinuity_abs_p95_m": best_extreme_p95,
                "p95_improvement_fraction": (
                    (best_extreme_p95 - sym_p95) / best_extreme_p95 if best_extreme_p95 > 0 else None
                ),
            },
            "claim_calibration": {
                "tests_buffer_removal_hypothesis": True,
                "production_seam_authority": False,
                "note": (
                    "A smooth or best-ranked 5/5 seam supports the core-clip hypothesis empirically, "
                    "but this experiment alone does not turn inferred border semantics into provider authority."
                ),
            },
        }
