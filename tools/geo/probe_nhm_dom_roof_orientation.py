#!/usr/bin/env python3
"""Measure whether 1 m NHM DOM-DTM samples support a stable roof-ridge direction.

This is a bounded experiment over the accepted Nannestad building footprints.
It does not emit surveyed roof geometry and does not modify the runtime artifact.
A candidate ridge is admitted only when a simple gable/tent surface model
materially outperforms a planar surface and the direction is discriminative.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.transform import xy as raster_xy
from rasterio.windows import Window, from_bounds, transform as window_transform
from shapely.geometry import Polygon, mapping


SCHEMA = "nwe.nhm-dom-roof-orientation-proof/0.1"
ANGLE_STEP_DEG = 2
MIN_SAMPLES = 20
MIN_RELIEF_M = 1.0
MIN_TENT_R2 = 0.55
MIN_R2_IMPROVEMENT = 0.12
MIN_ORTHOGONAL_GAP = 0.10
MAX_TENT_RMSE_M = 1.0
MIN_SLOPE_M_PER_M = 0.08
MAX_SLOPE_M_PER_M = 2.0


class RoofOrientationProofError(RuntimeError):
    pass


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clamped_window(bounds, transform, width: int, height: int) -> Window | None:
    raw = from_bounds(*bounds, transform=transform).round_offsets().round_lengths()
    col0 = max(0, int(raw.col_off))
    row0 = max(0, int(raw.row_off))
    col1 = min(width, int(raw.col_off + raw.width))
    row1 = min(height, int(raw.row_off + raw.height))
    if col1 <= col0 or row1 <= row0:
        return None
    return Window(col0, row0, col1 - col0, row1 - row0)


def _valid_delta(dtm: np.ndarray, dom: np.ndarray, dtm_nodata, dom_nodata) -> np.ndarray:
    valid = np.isfinite(dtm) & np.isfinite(dom)
    if dtm_nodata is not None and math.isfinite(float(dtm_nodata)):
        valid &= dtm != np.float32(dtm_nodata)
    if dom_nodata is not None and math.isfinite(float(dom_nodata)):
        valid &= dom != np.float32(dom_nodata)
    return np.where(valid, dom - dtm, np.nan)


def sample_roof_points(
    polygon: Polygon,
    delta: np.ndarray,
    transform,
    *,
    erosion_m: float = 0.75,
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    if polygon.is_empty or polygon.area <= 4.0:
        return None
    interior = polygon.buffer(-erosion_m)
    sampling = interior if not interior.is_empty and interior.area >= 8.0 else polygon
    window = _clamped_window(sampling.bounds, transform, delta.shape[1], delta.shape[0])
    if window is None:
        return None

    row0, col0 = int(window.row_off), int(window.col_off)
    height, width = int(window.height), int(window.width)
    subset = delta[row0 : row0 + height, col0 : col0 + width]
    mask = geometry_mask(
        [mapping(sampling)],
        out_shape=subset.shape,
        transform=window_transform(window, transform),
        invert=True,
        all_touched=False,
    )
    rows, cols = np.nonzero(mask & np.isfinite(subset))
    if rows.size < MIN_SAMPLES:
        return None
    values = subset[rows, cols].astype(np.float64)
    credible = (values >= 0.5) & (values <= 80.0)
    rows, cols, values = rows[credible], cols[credible], values[credible]
    if values.size < MIN_SAMPLES:
        return None

    global_rows = rows + row0
    global_cols = cols + col0
    eastings, northings = raster_xy(
        transform,
        global_rows.tolist(),
        global_cols.tolist(),
        offset="center",
    )
    return (
        np.asarray(eastings, dtype=np.float64),
        np.asarray(northings, dtype=np.float64),
        values,
    )


def _least_squares_metrics(matrix: np.ndarray, z: np.ndarray) -> tuple[np.ndarray, float, float]:
    coefficients, *_ = np.linalg.lstsq(matrix, z, rcond=None)
    predicted = matrix @ coefficients
    residual = z - predicted
    ss_res = float(np.dot(residual, residual))
    centered = z - float(np.mean(z))
    ss_tot = float(np.dot(centered, centered))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0
    rmse = math.sqrt(ss_res / len(z))
    return coefficients, r2, rmse


def _angular_difference_deg(a: float, b: float) -> float:
    difference = abs((a - b) % 180.0)
    return min(difference, 180.0 - difference)


def _orientation_fit(
    x: np.ndarray,
    y: np.ndarray,
    z: np.ndarray,
    angle_deg: float,
) -> dict:
    theta = math.radians(angle_deg)
    along = math.cos(theta) * x + math.sin(theta) * y
    cross = -math.sin(theta) * x + math.cos(theta) * y
    ridge_offset = float(np.median(cross))
    distance = np.abs(cross - ridge_offset)
    # z = intercept - roof_slope*distance + along_grade*along.
    matrix = np.column_stack(
        (
            np.ones_like(z),
            -distance,
            along,
        )
    )
    coefficients, r2, rmse = _least_squares_metrics(matrix, z)
    return {
        "angle_deg": float(angle_deg % 180.0),
        "r2": r2,
        "rmse_m": rmse,
        "roof_slope_m_per_m": float(coefficients[1]),
        "along_grade_m_per_m": float(coefficients[2]),
        "ridge_cross_offset_m": ridge_offset,
    }


def fit_roof_orientation(
    eastings: np.ndarray,
    northings: np.ndarray,
    heights: np.ndarray,
) -> dict:
    if len(heights) < MIN_SAMPLES:
        raise RoofOrientationProofError("roof fit needs at least 20 samples")
    x = eastings - float(np.mean(eastings))
    y = northings - float(np.mean(northings))

    low, high = np.percentile(heights, [10, 95])
    relief = float(high - low)
    # Winsorize tree/chimney spikes while retaining the roof's spatial signal.
    z = np.clip(heights, low, high)

    plane_matrix = np.column_stack((np.ones_like(z), x, y))
    _, plane_r2, plane_rmse = _least_squares_metrics(plane_matrix, z)

    fits = [
        _orientation_fit(x, y, z, angle)
        for angle in range(0, 180, ANGLE_STEP_DEG)
    ]
    fits.sort(key=lambda item: (-item["r2"], item["rmse_m"], item["angle_deg"]))
    best = fits[0]
    orthogonal_target = (best["angle_deg"] + 90.0) % 180.0
    orthogonal = min(
        fits,
        key=lambda item: _angular_difference_deg(item["angle_deg"], orthogonal_target),
    )
    accepted = (
        relief >= MIN_RELIEF_M
        and best["r2"] >= MIN_TENT_R2
        and best["r2"] - plane_r2 >= MIN_R2_IMPROVEMENT
        and best["r2"] - orthogonal["r2"] >= MIN_ORTHOGONAL_GAP
        and best["rmse_m"] <= MAX_TENT_RMSE_M
        and MIN_SLOPE_M_PER_M <= best["roof_slope_m_per_m"] <= MAX_SLOPE_M_PER_M
    )
    if relief < MIN_RELIEF_M:
        rejection = "low-relief"
    elif best["r2"] < MIN_TENT_R2:
        rejection = "weak-tent-fit"
    elif best["r2"] - plane_r2 < MIN_R2_IMPROVEMENT:
        rejection = "tent-not-better-than-plane"
    elif best["r2"] - orthogonal["r2"] < MIN_ORTHOGONAL_GAP:
        rejection = "orientation-ambiguous"
    elif best["rmse_m"] > MAX_TENT_RMSE_M:
        rejection = "high-residual"
    elif not (MIN_SLOPE_M_PER_M <= best["roof_slope_m_per_m"] <= MAX_SLOPE_M_PER_M):
        rejection = "implausible-roof-slope"
    else:
        rejection = None
    return {
        "status": "ACCEPTED_GABLE_LIKE_DIRECTION" if accepted else "REJECTED",
        "rejection_reason": rejection,
        "sample_count": int(len(heights)),
        "winsorized_p10_p95_relief_m": relief,
        "ridge_orientation_deg_from_east_ccw": best["angle_deg"],
        "tent_r2": best["r2"],
        "tent_rmse_m": best["rmse_m"],
        "tent_roof_slope_m_per_m": best["roof_slope_m_per_m"],
        "tent_along_grade_m_per_m": best["along_grade_m_per_m"],
        "plane_r2": plane_r2,
        "plane_rmse_m": plane_rmse,
        "r2_improvement_over_plane": best["r2"] - plane_r2,
        "orthogonal_r2": orthogonal["r2"],
        "orthogonal_gap": best["r2"] - orthogonal["r2"],
        "search_step_deg": ANGLE_STEP_DEG,
    }


def _long_axis_orientation_deg(polygon: Polygon) -> float | None:
    rectangle = polygon.minimum_rotated_rectangle
    coordinates = list(rectangle.exterior.coords)
    if len(coordinates) < 5:
        return None
    edges = []
    for a, b in zip(coordinates[:4], coordinates[1:5]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        edges.append((math.hypot(dx, dy), math.degrees(math.atan2(dy, dx)) % 180.0))
    length, angle = max(edges)
    if length <= 1e-6:
        return None
    return angle


def _offline_building_artifact(cache_root: Path) -> tuple[dict, dict]:
    completed = subprocess.run(
        [
            "nwe-compile-vectors",
            "--cache-root",
            str(cache_root),
            "--source",
            "buildings",
            "--offline",
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        raise RoofOrientationProofError(
            "offline building compile failed: "
            + (completed.stderr.strip() or completed.stdout.strip())
        )
    report = json.loads(completed.stdout)
    if report.get("status") != "PASS" or len(report.get("results", [])) != 1:
        raise RoofOrientationProofError("offline building compiler did not emit one PASS result")
    result = report["results"][0]
    artifact = json.loads(Path(result["artifact_path"]).read_text(encoding="utf-8"))
    return result, artifact


def run(
    *,
    work_dir: Path,
    cache_root: Path,
    height_proof: dict,
) -> dict:
    dtm_path = work_dir / "nannestad-dtm.tif"
    dom_path = work_dir / "nannestad-dom.tif"
    if not dtm_path.is_file() or not dom_path.is_file():
        raise RoofOrientationProofError(
            "expected existing DTM/DOM rasters from the building-height proof"
        )
    if (
        height_proof.get("schema") != "nwe.nhm-dom-building-height-proof/0.1"
        or height_proof.get("status") != "EXPERIMENT_PASS"
        or height_proof.get("source", {}).get("grid_alignment") != "EXACT_1M_MATCH"
    ):
        raise RoofOrientationProofError("height proof identity/status is not accepted")
    source_proof = height_proof["source"]
    if sha256_path(dtm_path) != source_proof["dtm"]["raw_sha256"]:
        raise RoofOrientationProofError("DTM raster bytes do not match height proof")
    if sha256_path(dom_path) != source_proof["dom"]["raw_sha256"]:
        raise RoofOrientationProofError("DOM raster bytes do not match height proof")
    with rasterio.open(dtm_path) as dtm_ds, rasterio.open(dom_path) as dom_ds:
        if (
            dtm_ds.crs != dom_ds.crs
            or dtm_ds.transform != dom_ds.transform
            or dtm_ds.width != dom_ds.width
            or dtm_ds.height != dom_ds.height
        ):
            raise RoofOrientationProofError("DTM/DOM grids are not aligned")
        dtm = dtm_ds.read(1, out_dtype="float32")
        dom = dom_ds.read(1, out_dtype="float32")
        transform = dtm_ds.transform
        delta = _valid_delta(dtm, dom, dtm_ds.nodata, dom_ds.nodata)

    building_result, building_artifact = _offline_building_artifact(cache_root)
    if building_result["artifact_sha256"] != source_proof["building_artifact_sha256"]:
        raise RoofOrientationProofError(
            "offline building artifact does not match the accepted height proof"
        )
    candidates = []
    rejected_counts: dict[str, int] = {}
    accepted = []
    for feature in building_artifact.get("features", []):
        polygon_raw = feature.get("polygon") if isinstance(feature, dict) else None
        if not isinstance(polygon_raw, list) or len(polygon_raw) < 4:
            continue
        polygon = Polygon(polygon_raw)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if polygon.is_empty:
            continue
        sampled = sample_roof_points(polygon, delta, transform)
        if sampled is None:
            rejected_counts["insufficient-spatial-samples"] = (
                rejected_counts.get("insufficient-spatial-samples", 0) + 1
            )
            continue
        fit = fit_roof_orientation(*sampled)
        long_axis = _long_axis_orientation_deg(polygon)
        if long_axis is not None:
            fit["footprint_long_axis_deg_from_east_ccw"] = long_axis
            fit["ridge_vs_footprint_long_axis_deg"] = _angular_difference_deg(
                fit["ridge_orientation_deg_from_east_ccw"],
                long_axis,
            )
        record = {
            "source_id": feature.get("source_id"),
            "building": feature.get("building"),
            "footprint_area_m2": float(polygon.area),
            **fit,
        }
        candidates.append(record)
        if fit["status"] == "ACCEPTED_GABLE_LIKE_DIRECTION":
            accepted.append(record)
        else:
            reason = str(fit["rejection_reason"])
            rejected_counts[reason] = rejected_counts.get(reason, 0) + 1

    if not candidates:
        raise RoofOrientationProofError("no building supplied enough spatial DOM samples")
    accepted_angles_to_axis = [
        item["ridge_vs_footprint_long_axis_deg"]
        for item in accepted
        if "ridge_vs_footprint_long_axis_deg" in item
    ]
    return {
        "schema": SCHEMA,
        "status": "EXPERIMENT_PASS",
        "tile_id": building_artifact.get("tile_id"),
        "horizontal_crs": building_artifact.get("horizontal_crs"),
        "source": {
            "building_artifact_sha256": building_result["artifact_sha256"],
            "dtm_raw_sha256": source_proof["dtm"]["raw_sha256"],
            "dtm_grid_sha256": source_proof["dtm"]["grid_sha256"],
            "dom_raw_sha256": source_proof["dom"]["raw_sha256"],
            "dom_grid_sha256": source_proof["dom"]["grid_sha256"],
            "dtm_path_role": "exact-1m-kartverket-nhm-dtm-proof-raster",
            "dom_path_role": "exact-1m-kartverket-nhm-dom-proof-raster",
            "runtime_source_calls": 0,
        },
        "policy": {
            "model": "centered-tent-plus-along-ridge-grade-v0.1",
            "angle_search_step_deg": ANGLE_STEP_DEG,
            "winsorization": "p10-p95",
            "min_samples": MIN_SAMPLES,
            "min_relief_m": MIN_RELIEF_M,
            "min_tent_r2": MIN_TENT_R2,
            "min_r2_improvement_over_plane": MIN_R2_IMPROVEMENT,
            "min_orthogonal_r2_gap": MIN_ORTHOGONAL_GAP,
            "max_tent_rmse_m": MAX_TENT_RMSE_M,
            "roof_slope_range_m_per_m": [MIN_SLOPE_M_PER_M, MAX_SLOPE_M_PER_M],
        },
        "stats": {
            "compiled_buildings": int(building_result["compiled_count"]),
            "spatially_analyzed": len(candidates),
            "accepted_gable_like_direction": len(accepted),
            "rejected": {key: rejected_counts[key] for key in sorted(rejected_counts)},
            "accepted_fraction_of_analyzed": len(accepted) / len(candidates),
            "median_accepted_ridge_vs_long_axis_deg": (
                float(np.median(accepted_angles_to_axis))
                if accepted_angles_to_axis
                else None
            ),
        },
        "candidates": candidates,
        "decision": {
            "production_selected": False,
            "runtime_roof_shape_changed": False,
            "runtime_roof_orientation_changed": False,
            "next_gate": (
                "review accepted count/residual/confidence distribution and reject or "
                "compile a separately versioned ridge-orientation candidate"
            ),
        },
        "truth_boundary": (
            "The accepted direction is a fitted interpretation of source-backed 1 m "
            "DOM-DTM samples inside an OSM footprint. It is not a surveyed FKB ridge "
            "or a claim that the building roof is actually gabled."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--height-proof", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    height_proof = json.loads(args.height_proof.read_text(encoding="utf-8"))
    result = run(
        work_dir=args.work_dir,
        cache_root=args.cache_root,
        height_proof=height_proof,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "status": result["status"],
                "stats": result["stats"],
                "decision": result["decision"],
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RoofOrientationProofError as exc:
        print(f"NWE_NHM_DOM_ROOF_ORIENTATION_REJECTED: {exc}", file=__import__("sys").stderr)
        raise SystemExit(1)
