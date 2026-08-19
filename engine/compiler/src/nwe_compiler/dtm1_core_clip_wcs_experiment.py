from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer

from nwe_compiler.dtm1_core_clip_experiment import _assert_source, _orientation, _quantiles, _snap_metre
from nwe_compiler.seam_diagnostic import SeamDiagnosticError


def _read_grid(path: Path) -> tuple[np.ndarray, Any, Any, float | None]:
    with rasterio.open(path) as dataset:
        return (
            dataset.read(1, out_dtype="float32"),
            dataset.transform,
            dataset.crs,
            dataset.nodata,
        )


def _valid(data: np.ndarray, nodata: float | None) -> np.ndarray:
    mask = np.isfinite(data)
    if nodata is not None and math.isfinite(float(nodata)):
        mask &= data != np.float32(nodata)
    return mask


def _residual_metrics(candidate: np.ndarray, reference: np.ndarray, mask: np.ndarray) -> dict[str, Any]:
    count = int(np.count_nonzero(mask))
    if count == 0:
        raise SeamDiagnosticError("candidate/reference comparison has no valid pixels")
    residual = candidate[mask].astype("float64") - reference[mask].astype("float64")
    absolute = np.abs(residual)
    return {
        "valid_pixels": count,
        "signed_residual_m": _quantiles(residual),
        "absolute_residual_m": _quantiles(absolute),
        "rmse_m": float(np.sqrt(np.mean(residual**2))),
        "mae_m": float(np.mean(absolute)),
        "exact_within_1e5_pixels": int(np.count_nonzero(absolute <= 1e-5)),
        "within_1cm_fraction": float(np.mean(absolute <= 0.01)),
        "within_5cm_fraction": float(np.mean(absolute <= 0.05)),
    }


def compare_core_clip_candidates_to_reference(
    source_a_raw: Path,
    source_b_raw: Path,
    source_a_normalized: Path,
    source_b_normalized: Path,
    reference: Path,
    *,
    symmetric_inset_px: int = 5,
) -> dict[str, Any]:
    """Compare every integer ownership split in one DTM1 overlap to a QA reference.

    The reference is deliberately a QA/control surface only. It cannot make a
    seam policy authoritative. This experiment answers a narrower question:
    whether the provider's seamless 1 m WCS behaves like any of the possible
    hard ownership boundaries through the exact raw-source overlap.
    """
    if not isinstance(symmetric_inset_px, int) or isinstance(symmetric_inset_px, bool) or symmetric_inset_px < 0:
        raise SeamDiagnosticError("symmetric_inset_px must be a non-negative integer")

    a, ta, ca, na = _read_grid(source_a_normalized)
    b, tb, cb, nb = _read_grid(source_b_normalized)
    ref, tr, cr, nr = _read_grid(reference)
    if a.shape != b.shape or a.shape != ref.shape:
        raise SeamDiagnosticError(f"comparison grid shape mismatch: {a.shape}, {b.shape}, {ref.shape}")
    if ta != tb or ta != tr:
        raise SeamDiagnosticError("comparison grids do not share the exact transform")
    if ca != cb or ca != cr:
        raise SeamDiagnosticError("comparison grids do not share the exact CRS")
    if cr is None:
        raise SeamDiagnosticError("comparison CRS must be explicit")

    valid_a = _valid(a, na)
    valid_b = _valid(b, nb)
    valid_ref = _valid(ref, nr)
    union = valid_a | valid_b
    missing = valid_ref & ~union
    if np.any(missing):
        raise SeamDiagnosticError(
            f"normalized raw candidates leave {int(np.count_nonzero(missing))} reference pixels uncovered"
        )

    with rasterio.open(source_a_raw) as raw_a, rasterio.open(source_b_raw) as raw_b:
        _assert_source(raw_a, "source_a")
        _assert_source(raw_b, "source_b")
        if raw_a.crs != raw_b.crs:
            raise SeamDiagnosticError("raw source CRS mismatch")
        axis, lower_or_left_raw, upper_or_right_raw = _orientation(raw_a, raw_b)
        lower_is_a = lower_or_left_raw is raw_a
        source_crs = raw_a.crs
        if axis == "north_south":
            overlap_start = _snap_metre(max(raw_a.bounds.bottom, raw_b.bounds.bottom), "overlap bottom")
            overlap_end = _snap_metre(min(raw_a.bounds.top, raw_b.bounds.top), "overlap top")
        else:
            overlap_start = _snap_metre(max(raw_a.bounds.left, raw_b.bounds.left), "overlap left")
            overlap_end = _snap_metre(min(raw_a.bounds.right, raw_b.bounds.right), "overlap right")

    overlap_m = int(round(overlap_end - overlap_start))
    if overlap_m <= 0:
        raise SeamDiagnosticError("raw sources do not overlap")
    if overlap_m != 2 * symmetric_inset_px:
        raise SeamDiagnosticError(
            f"raw overlap {overlap_m} m does not match 2 x symmetric inset {symmetric_inset_px} m"
        )

    lower = a if lower_is_a else b
    upper = b if lower_is_a else a
    valid_lower = valid_a if lower_is_a else valid_b
    valid_upper = valid_b if lower_is_a else valid_a

    height, width = ref.shape
    rows, cols = np.indices((height, width), dtype="float64")
    xs = tr.c + (cols + 0.5) * tr.a + (rows + 0.5) * tr.b
    ys = tr.f + (cols + 0.5) * tr.d + (rows + 0.5) * tr.e
    to_source = Transformer.from_crs(cr, source_crs, always_xy=True)
    sx, sy = to_source.transform(xs, ys)
    sx = np.asarray(sx, dtype="float64")
    sy = np.asarray(sy, dtype="float64")
    coordinate = sy if axis == "north_south" else sx

    only_lower = valid_lower & ~valid_upper
    only_upper = valid_upper & ~valid_lower
    both = valid_lower & valid_upper
    overlap_band = both & (coordinate >= overlap_start) & (coordinate < overlap_end)
    if not np.any(valid_ref & overlap_band):
        raise SeamDiagnosticError("target/reference grid contains no valid raw-overlap pixels")

    candidates: list[dict[str, Any]] = []
    for offset in range(overlap_m + 1):
        seam = overlap_start + offset
        lower_trim = overlap_end - seam
        upper_trim = seam - overlap_start
        choose_lower = both & (coordinate < seam)
        choose_upper = both & ~choose_lower

        candidate = np.full(ref.shape, np.nan, dtype="float64")
        candidate[only_lower] = lower[only_lower]
        candidate[only_upper] = upper[only_upper]
        candidate[choose_lower] = lower[choose_lower]
        candidate[choose_upper] = upper[choose_upper]

        candidate_valid = np.isfinite(candidate)
        full_mask = valid_ref & candidate_valid
        overlap_mask = valid_ref & overlap_band & candidate_valid
        candidates.append(
            {
                "seam_coordinate_epsg25833": seam,
                "lower_or_left_source_trim_m": lower_trim,
                "upper_or_right_source_trim_m": upper_trim,
                "symmetric": lower_trim == symmetric_inset_px and upper_trim == symmetric_inset_px,
                "full_tile": _residual_metrics(candidate, ref, full_mask),
                "raw_overlap_band_only": _residual_metrics(candidate, ref, overlap_mask),
                "selected_source_pixels": {
                    "lower_or_left": int(np.count_nonzero(full_mask & (only_lower | choose_lower))),
                    "upper_or_right": int(np.count_nonzero(full_mask & (only_upper | choose_upper))),
                },
            }
        )

    ranking = sorted(
        candidates,
        key=lambda item: (
            item["raw_overlap_band_only"]["rmse_m"],
            item["raw_overlap_band_only"]["mae_m"],
            item["full_tile"]["rmse_m"],
            item["seam_coordinate_epsg25833"],
        ),
    )
    for rank, item in enumerate(ranking, start=1):
        item["rank_by_reference_overlap_rmse"] = rank
    rank_by_coord = {
        item["seam_coordinate_epsg25833"]: item["rank_by_reference_overlap_rmse"]
        for item in ranking
    }
    for item in candidates:
        item["rank_by_reference_overlap_rmse"] = rank_by_coord[item["seam_coordinate_epsg25833"]]

    symmetric = next(item for item in candidates if item["symmetric"])
    best = ranking[0]
    best_extreme = min(
        (item for item in candidates if item["lower_or_left_source_trim_m"] == 0 or item["upper_or_right_source_trim_m"] == 0),
        key=lambda item: (
            item["raw_overlap_band_only"]["rmse_m"],
            item["raw_overlap_band_only"]["mae_m"],
        ),
    )

    return {
        "schema": "nwe.dtm1-core-clip-wcs-qa/0.1",
        "role": "independent_provider_wcs_qa_sensor_not_source_authority",
        "axis": axis,
        "raw_overlap_m": overlap_m,
        "symmetric_inset_px": symmetric_inset_px,
        "candidate_count": len(candidates),
        "target_grid": {
            "crs": cr.to_string(),
            "width": width,
            "height": height,
            "transform": list(tr)[:6],
            "reference_valid_pixels": int(np.count_nonzero(valid_ref)),
            "raw_overlap_reference_pixels": int(np.count_nonzero(valid_ref & overlap_band)),
        },
        "candidates": candidates,
        "ranking_by_reference_overlap_rmse": [
            {
                "rank": item["rank_by_reference_overlap_rmse"],
                "seam_coordinate_epsg25833": item["seam_coordinate_epsg25833"],
                "lower_or_left_source_trim_m": item["lower_or_left_source_trim_m"],
                "upper_or_right_source_trim_m": item["upper_or_right_source_trim_m"],
                "symmetric": item["symmetric"],
                "overlap_rmse_m": item["raw_overlap_band_only"]["rmse_m"],
                "overlap_mae_m": item["raw_overlap_band_only"]["mae_m"],
                "overlap_exact_pixels": item["raw_overlap_band_only"]["exact_within_1e5_pixels"],
                "full_tile_rmse_m": item["full_tile"]["rmse_m"],
            }
            for item in ranking
        ],
        "best_candidate": best,
        "symmetric_candidate": symmetric,
        "best_extreme_candidate": best_extreme,
        "symmetric_vs_best": {
            "symmetric_overlap_rmse_m": symmetric["raw_overlap_band_only"]["rmse_m"],
            "best_overlap_rmse_m": best["raw_overlap_band_only"]["rmse_m"],
            "rmse_delta_m": symmetric["raw_overlap_band_only"]["rmse_m"] - best["raw_overlap_band_only"]["rmse_m"],
        },
        "claim_calibration": {
            "wcs_can_promote_source_authority": False,
            "production_seam_authority": False,
            "note": (
                "A WCS match can corroborate provider composition behavior, but the WCS is an independent QA surface, "
                "not the SHA-addressed Atom source authority."
            ),
        },
    }
