from __future__ import annotations

import argparse
import hashlib
import json
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

    # Both DTM1 objects are 1 m north-up grids. Fail if the declared grids are
    # not on the same integer-metre lattice rather than silently resampling an
    # already ambiguous source seam.
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
    count_axis = 1 if axis == 0 else 0
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
        "source_a": {
            "path_name": source_a.name,
            "sha256": _sha256(source_a),
            "byte_size": source_a.stat().st_size,
        },
        "source_b": {
            "path_name": source_b.name,
            "sha256": _sha256(source_b),
            "byte_size": source_b.stat().st_size,
        },
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


def compare_normalized_sources_to_reference(
    source_a_normalized: Path,
    source_b_normalized: Path,
    reference: Path,
) -> dict:
    a, transform_a, crs_a, nodata_a = _read_float_grid(source_a_normalized)
    b, transform_b, crs_b, nodata_b = _read_float_grid(source_b_normalized)
    ref, transform_ref, crs_ref, nodata_ref = _read_float_grid(reference)
    if a.shape != b.shape or a.shape != ref.shape:
        raise SeamDiagnosticError(f"comparison grid shape mismatch: {a.shape}, {b.shape}, {ref.shape}")
    if transform_a != transform_b or transform_a != transform_ref:
        raise SeamDiagnosticError("comparison grids do not share the exact transform")
    if crs_a != crs_b or crs_a != crs_ref:
        raise SeamDiagnosticError("comparison grids do not share the exact CRS")

    valid_a = _valid_mask(a, nodata_a)
    valid_b = _valid_mask(b, nodata_b)
    valid_ref = _valid_mask(ref, nodata_ref)
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure a DTM1 source seam without selecting a seam policy.")
    parser.add_argument("--source-a", type=Path, required=True)
    parser.add_argument("--source-b", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--normalized-a", type=Path)
    parser.add_argument("--normalized-b", type=Path)
    parser.add_argument("--reference", type=Path)
    args = parser.parse_args()

    result: dict[str, Any] = {
        "schema": "nwe.dtm1-seam-diagnostic/0.1",
        "raw_overlap": analyze_raw_overlap(args.source_a, args.source_b),
    }
    comparison_args = (args.normalized_a, args.normalized_b, args.reference)
    if any(value is not None for value in comparison_args):
        if not all(value is not None for value in comparison_args):
            raise SeamDiagnosticError("normalized-a, normalized-b and reference must be supplied together")
        result["reference_comparison"] = compare_normalized_sources_to_reference(
            args.normalized_a, args.normalized_b, args.reference
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
