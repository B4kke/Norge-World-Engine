from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin, xy
from rasterio.warp import reproject


class SeamDiagnosticError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _assert_source_contract(dataset: rasterio.io.DatasetReader, *, label: str) -> None:
    if dataset.crs is None or dataset.crs.to_string() != "EPSG:25833":
        raise SeamDiagnosticError(f"{label}: expected EPSG:25833, got {dataset.crs}")
    if dataset.count != 1:
        raise SeamDiagnosticError(f"{label}: expected one band, got {dataset.count}")
    if dataset.nodata is None:
        raise SeamDiagnosticError(f"{label}: nodata must be explicit")
    if abs(abs(dataset.transform.a) - 1.0) > 1e-6 or abs(abs(dataset.transform.e) - 1.0) > 1e-6:
        raise SeamDiagnosticError(f"{label}: expected 1 m source grid")
    if dataset.transform.b != 0 or dataset.transform.d != 0:
        raise SeamDiagnosticError(f"{label}: rotated/sheared source grid is unsupported")


def _common_overlap_grid(a, b) -> tuple[tuple[float, float, float, float], Any, int, int]:
    left = max(a.bounds.left, b.bounds.left)
    bottom = max(a.bounds.bottom, b.bounds.bottom)
    right = min(a.bounds.right, b.bounds.right)
    top = min(a.bounds.top, b.bounds.top)
    if right <= left or top <= bottom:
        raise SeamDiagnosticError("source rasters have no spatial overlap")
    values = (left, bottom, right, top)
    if any(abs(value - round(value)) > 1e-6 for value in values):
        raise SeamDiagnosticError(f"overlap bounds are not integer-metre aligned: {values}")
    left, bottom, right, top = (float(round(value)) for value in values)
    width = int(round(right - left))
    height = int(round(top - bottom))
    if width <= 0 or height <= 0:
        raise SeamDiagnosticError("invalid overlap grid dimensions")
    return (left, bottom, right, top), from_origin(left, top, 1.0, 1.0), width, height


def _read_to_grid(dataset, transform, width: int, height: int) -> np.ndarray:
    destination = np.full((height, width), np.nan, dtype="float32")
    reproject(
        source=rasterio.band(dataset, 1),
        destination=destination,
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
    return destination


def _quantiles(values: np.ndarray) -> dict[str, float]:
    if values.size == 0:
        raise SeamDiagnosticError("cannot summarize empty value set")
    return {
        "min": float(np.min(values)),
        "p50": float(np.quantile(values, 0.50)),
        "p90": float(np.quantile(values, 0.90)),
        "p95": float(np.quantile(values, 0.95)),
        "p99": float(np.quantile(values, 0.99)),
        "p999": float(np.quantile(values, 0.999)),
        "max": float(np.max(values)),
        "mean": float(np.mean(values)),
    }


def _top_axis_stats(abs_delta: np.ndarray, valid: np.ndarray, axis: int, limit: int = 12) -> list[dict[str, float | int]]:
    rows: list[tuple[float, int, int, float]] = []
    for index in range(abs_delta.shape[axis]):
        selector = (index, slice(None)) if axis == 0 else (slice(None), index)
        mask = valid[selector]
        if not np.any(mask):
            continue
        values = abs_delta[selector][mask]
        rows.append((float(np.mean(values)), index, int(values.size), float(np.max(values))))
    rows.sort(reverse=True)
    return [
        {"index": index, "valid_pixels": count, "mean_abs_delta_m": mean, "max_abs_delta_m": maximum}
        for mean, index, count, maximum in rows[:limit]
    ]


def analyze_raw_overlap(source_a: Path, source_b: Path) -> dict:
    with rasterio.open(source_a) as a, rasterio.open(source_b) as b:
        _assert_source_contract(a, label="source_a")
        _assert_source_contract(b, label="source_b")
        if a.crs != b.crs:
            raise SeamDiagnosticError(f"source CRS mismatch: {a.crs} != {b.crs}")
        if float(a.nodata) != float(b.nodata):
            raise SeamDiagnosticError(f"source nodata mismatch: {a.nodata} != {b.nodata}")
        overlap_bounds, transform, width, height = _common_overlap_grid(a, b)
        values_a = _read_to_grid(a, transform, width, height)
        values_b = _read_to_grid(b, transform, width, height)

    valid = np.isfinite(values_a) & np.isfinite(values_b)
    valid_count = int(np.count_nonzero(valid))
    if valid_count == 0:
        raise SeamDiagnosticError("source rasters have no overlapping valid samples")
    signed = values_a[valid].astype("float64") - values_b[valid].astype("float64")
    absolute = np.abs(signed)
    differing = absolute > 0.0
    differing_count = int(np.count_nonzero(differing))
    maximum_flat = int(np.argmax(absolute))
    valid_rows, valid_cols = np.where(valid)
    max_row = int(valid_rows[maximum_flat])
    max_col = int(valid_cols[maximum_flat])
    max_e, max_n = xy(transform, max_row, max_col, offset="center")
    to_world = Transformer.from_crs("EPSG:25833", "EPSG:25832", always_xy=True)
    to_wgs84 = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)
    max_world_e, max_world_n = to_world.transform(max_e, max_n)
    max_lon, max_lat = to_wgs84.transform(max_e, max_n)

    abs_grid = np.abs(values_a.astype("float64") - values_b.astype("float64"))
    abs_grid[~valid] = np.nan
    return {
        "schema": "nwe.dtm1-raw-seam-overlap/0.1",
        "source_a": {"path_name": source_a.name, "sha256": _sha256(source_a), "byte_size": source_a.stat().st_size},
        "source_b": {"path_name": source_b.name, "sha256": _sha256(source_b), "byte_size": source_b.stat().st_size},
        "overlap_bounds_epsg25833": list(overlap_bounds),
        "overlap_width": width,
        "overlap_height": height,
        "valid_overlap_pixels": valid_count,
        "differing_pixels": differing_count,
        "differing_fraction": differing_count / valid_count,
        "signed_delta_a_minus_b_m": _quantiles(signed),
        "absolute_delta_m": _quantiles(absolute),
        "a_higher_pixels": int(np.count_nonzero(signed > 0)),
        "b_higher_pixels": int(np.count_nonzero(signed < 0)),
        "equal_pixels": int(np.count_nonzero(signed == 0)),
        "max_delta_location": {
            "row": max_row,
            "column": max_col,
            "epsg25833": [float(max_e), float(max_n)],
            "epsg25832": [float(max_world_e), float(max_world_n)],
            "wgs84_lon_lat": [float(max_lon), float(max_lat)],
            "source_a_m": float(values_a[max_row, max_col]),
            "source_b_m": float(values_b[max_row, max_col]),
            "signed_a_minus_b_m": float(values_a[max_row, max_col] - values_b[max_row, max_col]),
            "absolute_delta_m": float(abs_grid[max_row, max_col]),
        },
        "highest_mean_abs_delta_rows": _top_axis_stats(abs_grid, valid, axis=0),
        "highest_mean_abs_delta_columns": _top_axis_stats(abs_grid, valid, axis=1),
    }


def _read_float_grid(path: Path) -> tuple[np.ndarray, Any, Any, float | None]:
    with rasterio.open(path) as dataset:
        data = dataset.read(1, out_dtype="float32")
        return data, dataset.transform, dataset.crs, dataset.nodata


def _valid_mask(data: np.ndarray, nodata: float | None) -> np.ndarray:
    mask = np.isfinite(data)
    if nodata is not None and math.isfinite(float(nodata)):
        mask &= data != np.float32(nodata)
    return mask


def _comparison_grid(
    source_a_normalized: Path,
    source_b_normalized: Path,
    reference: Path,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, Any, Any, np.ndarray, np.ndarray, np.ndarray]:
    a, transform_a, crs_a, nodata_a = _read_float_grid(source_a_normalized)
    b, transform_b, crs_b, nodata_b = _read_float_grid(source_b_normalized)
    ref, transform_ref, crs_ref, nodata_ref = _read_float_grid(reference)
    if a.shape != b.shape or a.shape != ref.shape:
        raise SeamDiagnosticError(f"comparison grid shape mismatch: {a.shape}, {b.shape}, {ref.shape}")
    if transform_a != transform_b or transform_a != transform_ref:
        raise SeamDiagnosticError("comparison grids do not share the exact transform")
    if crs_a != crs_b or crs_a != crs_ref:
        raise SeamDiagnosticError("comparison grids do not share the exact CRS")
    return (
        a,
        b,
        ref,
        transform_ref,
        crs_ref,
        _valid_mask(a, nodata_a),
        _valid_mask(b, nodata_b),
        _valid_mask(ref, nodata_ref),
    )


def _residual_metrics(candidate: np.ndarray, reference: np.ndarray, mask: np.ndarray) -> dict:
    count = int(np.count_nonzero(mask))
    if count == 0:
        raise SeamDiagnosticError("candidate comparison has no valid reference pixels")
    residual = candidate[mask].astype("float64") - reference[mask].astype("float64")
    absolute = np.abs(residual)
    return {
        "valid_pixels": count,
        "signed_residual_m": _quantiles(residual),
        "absolute_residual_m": _quantiles(absolute),
        "rmse_m": float(np.sqrt(np.mean(residual**2))),
        "mae_m": float(np.mean(absolute)),
        "exact_within_1e-5_pixels": int(np.count_nonzero(absolute <= 1e-5)),
        "within_1cm_fraction": float(np.mean(absolute <= 0.01)),
        "within_5cm_fraction": float(np.mean(absolute <= 0.05)),
    }


def compare_normalized_sources_to_reference(source_a_normalized: Path, source_b_normalized: Path, reference: Path) -> dict:
    a, b, ref, _, _, valid_a, valid_b, valid_ref = _comparison_grid(
        source_a_normalized, source_b_normalized, reference
    )
    all_valid = valid_a & valid_b & valid_ref
    count = int(np.count_nonzero(all_valid))
    if count == 0:
        raise SeamDiagnosticError("no pixels are valid in both raw-source projections and reference")

    av = a[all_valid].astype("float64")
    bv = b[all_valid].astype("float64")
    rv = ref[all_valid].astype("float64")
    residual_a = av - rv
    residual_b = bv - rv
    abs_a = np.abs(residual_a)
    abs_b = np.abs(residual_b)
    closer_a = abs_a < abs_b
    closer_b = abs_b < abs_a
    equal_distance = abs_a == abs_b
    raw_delta = bv - av
    changed_raw = np.abs(raw_delta) > 1e-9
    ratio_values = (rv[changed_raw] - av[changed_raw]) / raw_delta[changed_raw] if np.any(changed_raw) else np.array([])

    return {
        "schema": "nwe.dtm1-seam-reference-comparison/0.1",
        "valid_common_pixels": count,
        "reference_vs_source_a": {
            "signed_residual_m": _quantiles(residual_a),
            "absolute_residual_m": _quantiles(abs_a),
            "rmse_m": float(np.sqrt(np.mean(residual_a**2))),
            "exact_within_1e-5_pixels": int(np.count_nonzero(abs_a <= 1e-5)),
        },
        "reference_vs_source_b": {
            "signed_residual_m": _quantiles(residual_b),
            "absolute_residual_m": _quantiles(abs_b),
            "rmse_m": float(np.sqrt(np.mean(residual_b**2))),
            "exact_within_1e-5_pixels": int(np.count_nonzero(abs_b <= 1e-5)),
        },
        "closer_source": {
            "source_a_pixels": int(np.count_nonzero(closer_a)),
            "source_b_pixels": int(np.count_nonzero(closer_b)),
            "equal_distance_pixels": int(np.count_nonzero(equal_distance)),
        },
        "reference_position_between_raw_surfaces": (
            {
                "sample_count": int(ratio_values.size),
                "ratio_0_is_a_1_is_b": _quantiles(ratio_values),
                "between_0_and_1_fraction": float(np.mean((ratio_values >= 0.0) & (ratio_values <= 1.0))),
            }
            if ratio_values.size
            else {"sample_count": 0}
        ),
    }


def _margin_to_bounds(x: np.ndarray, y: np.ndarray, bounds: tuple[float, float, float, float]) -> np.ndarray:
    left, bottom, right, top = bounds
    return np.minimum.reduce((x - left, right - x, y - bottom, top - y))


def compare_mosaic_policies_to_reference(
    source_a_raw: Path,
    source_b_raw: Path,
    source_a_normalized: Path,
    source_b_normalized: Path,
    reference: Path,
) -> dict:
    """Compare explicit mosaic policies without selecting one as production truth.

    Policies operate only where both projected source candidates are valid. Where
    exactly one source is valid, every policy uses that source. The QA reference
    is not an input to any candidate; it is used only after each deterministic
    candidate has been constructed.
    """

    a, b, ref, transform, target_crs, valid_a, valid_b, valid_ref = _comparison_grid(
        source_a_normalized, source_b_normalized, reference
    )
    with rasterio.open(source_a_raw) as raw_a, rasterio.open(source_b_raw) as raw_b:
        _assert_source_contract(raw_a, label="source_a")
        _assert_source_contract(raw_b, label="source_b")
        if raw_a.crs != raw_b.crs:
            raise SeamDiagnosticError("raw source CRS mismatch")
        bounds_a = tuple(float(value) for value in raw_a.bounds)
        bounds_b = tuple(float(value) for value in raw_b.bounds)
        source_crs = raw_a.crs

    height, width = ref.shape
    rows, cols = np.indices((height, width), dtype="float64")
    xs = transform.c + (cols + 0.5) * transform.a + (rows + 0.5) * transform.b
    ys = transform.f + (cols + 0.5) * transform.d + (rows + 0.5) * transform.e
    to_source = Transformer.from_crs(target_crs, source_crs, always_xy=True)
    source_x, source_y = to_source.transform(xs, ys)
    source_x = np.asarray(source_x, dtype="float64")
    source_y = np.asarray(source_y, dtype="float64")
    margin_a = _margin_to_bounds(source_x, source_y, bounds_a)
    margin_b = _margin_to_bounds(source_x, source_y, bounds_b)

    only_a = valid_a & ~valid_b
    only_b = valid_b & ~valid_a
    both = valid_a & valid_b
    union = valid_a | valid_b
    if not np.all(union[valid_ref]):
        missing = int(np.count_nonzero(valid_ref & ~union))
        raise SeamDiagnosticError(f"mosaic candidates leave {missing} QA-reference pixels without source coverage")

    def base_candidate() -> np.ndarray:
        candidate = np.full(a.shape, np.nan, dtype="float64")
        candidate[only_a] = a[only_a]
        candidate[only_b] = b[only_b]
        return candidate

    candidates: dict[str, np.ndarray] = {}

    prefer_a = base_candidate()
    prefer_a[both] = a[both]
    candidates["prefer_source_a"] = prefer_a

    prefer_b = base_candidate()
    prefer_b[both] = b[both]
    candidates["prefer_source_b"] = prefer_b

    mean = base_candidate()
    mean[both] = (a[both].astype("float64") + b[both].astype("float64")) / 2.0
    candidates["mean_overlap"] = mean

    interior_owner = base_candidate()
    choose_a = both & (margin_a >= margin_b)
    choose_b = both & ~choose_a
    interior_owner[choose_a] = a[choose_a]
    interior_owner[choose_b] = b[choose_b]
    candidates["max_interior_margin_owner"] = interior_owner

    feather = base_candidate()
    positive_a = np.maximum(margin_a, 0.0)
    positive_b = np.maximum(margin_b, 0.0)
    total = positive_a + positive_b
    usable_weight = both & (total > 0.0)
    feather[usable_weight] = (
        a[usable_weight].astype("float64") * positive_a[usable_weight]
        + b[usable_weight].astype("float64") * positive_b[usable_weight]
    ) / total[usable_weight]
    zero_weight = both & ~usable_weight
    feather[zero_weight] = (a[zero_weight].astype("float64") + b[zero_weight].astype("float64")) / 2.0
    candidates["edge_distance_feather"] = feather

    full_mask = valid_ref & union
    overlap_mask = valid_ref & both
    policy_metrics = {}
    for name, candidate in candidates.items():
        policy_metrics[name] = {
            "full_tile": _residual_metrics(candidate, ref, full_mask),
            "overlap_only": _residual_metrics(candidate, ref, overlap_mask),
        }

    ranking = sorted(
        (
            {
                "policy": name,
                "overlap_rmse_m": metrics["overlap_only"]["rmse_m"],
                "overlap_mae_m": metrics["overlap_only"]["mae_m"],
                "full_tile_rmse_m": metrics["full_tile"]["rmse_m"],
            }
            for name, metrics in policy_metrics.items()
        ),
        key=lambda item: (item["overlap_rmse_m"], item["overlap_mae_m"], item["policy"]),
    )

    return {
        "schema": "nwe.dtm1-mosaic-policy-qa/0.1",
        "role": "diagnostic_comparison_only_no_policy_selected",
        "source_a_bounds_epsg25833": list(bounds_a),
        "source_b_bounds_epsg25833": list(bounds_b),
        "full_tile_reference_pixels": int(np.count_nonzero(full_mask)),
        "overlap_reference_pixels": int(np.count_nonzero(overlap_mask)),
        "policies": policy_metrics,
        "ranking_by_overlap_rmse": ranking,
    }
