#!/usr/bin/env python3
"""Calibrate NHM DOM-DTM building-height estimators on the real Nannestad 1 km tile.

This proof downloads the exact 1 m Kartverket NHM DTM and DOM grids, compiles the
current OSM building footprint artifact, samples DOM-DTM only inside each
footprint, and compares robust surface-height quantiles with already source-backed
OSM building heights.

It is an experiment: no building artifact or production decision is modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import urllib.request

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import Window, from_bounds, transform as window_transform
from shapely.geometry import Polygon, mapping

from nwe_compiler.nhm_dom_wcs_source_candidate import (
    getcoverage_url as dom_getcoverage_url,
    validate_getcoverage as validate_dom,
)
from nwe_compiler.nhm_wcs_source_candidate import (
    getcoverage_url as dtm_getcoverage_url,
    validate_getcoverage as validate_dtm,
)
from nwe_compiler.tiles import NANNESTAD_TILE


USER_AGENT = "NorgeWorldEngine/0.1 nhm-dom-building-height-proof"
ESTIMATORS = ("p50", "p75", "p90", "p95")


class BuildingHeightProofError(RuntimeError):
    pass


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "image/tiff,application/geotiff,application/octet-stream;q=0.9,*/*;q=0.1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            if getattr(response, "status", 200) != 200:
                raise BuildingHeightProofError(f"HTTP {response.status}: {url}")
            data = response.read()
    except BuildingHeightProofError:
        raise
    except Exception as exc:
        raise BuildingHeightProofError(f"download failed: {url}: {exc}") from exc
    if not data:
        raise BuildingHeightProofError(f"provider returned zero bytes: {url}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compile_buildings(cache_root: Path) -> tuple[dict, dict]:
    completed = subprocess.run(
        [
            "nwe-compile-vectors",
            "--cache-root",
            str(cache_root),
            "--source",
            "buildings",
            "--refresh",
        ],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        raise BuildingHeightProofError(
            "building compiler failed: "
            + (completed.stderr.strip() or completed.stdout.strip())
        )
    report = json.loads(completed.stdout)
    if report.get("status") != "PASS" or len(report.get("results", [])) != 1:
        raise BuildingHeightProofError("building compiler did not emit one PASS result")
    result = report["results"][0]
    artifact_path = Path(result["artifact_path"])
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    if artifact.get("schema") != "nwe.building-footprint-artifact/0.1":
        raise BuildingHeightProofError("building compiler emitted unexpected artifact schema")
    return result, artifact


def aligned_grids(dtm_path: Path, dom_path: Path) -> tuple[np.ndarray, np.ndarray, object, float | None, float | None]:
    with rasterio.open(dtm_path) as dtm_ds, rasterio.open(dom_path) as dom_ds:
        if (
            dtm_ds.crs != dom_ds.crs
            or dtm_ds.width != dom_ds.width
            or dtm_ds.height != dom_ds.height
            or dtm_ds.transform != dom_ds.transform
            or tuple(dtm_ds.bounds) != tuple(dom_ds.bounds)
        ):
            raise BuildingHeightProofError("NHM DTM and DOM grids are not exactly aligned")
        dtm = dtm_ds.read(1, out_dtype="float32")
        dom = dom_ds.read(1, out_dtype="float32")
        transform = dtm_ds.transform
        return dtm, dom, transform, dtm_ds.nodata, dom_ds.nodata


def valid_delta(dtm: np.ndarray, dom: np.ndarray, dtm_nodata, dom_nodata) -> np.ndarray:
    valid = np.isfinite(dtm) & np.isfinite(dom)
    if dtm_nodata is not None and math.isfinite(float(dtm_nodata)):
        valid &= dtm != np.float32(dtm_nodata)
    if dom_nodata is not None and math.isfinite(float(dom_nodata)):
        valid &= dom != np.float32(dom_nodata)
    return np.where(valid, dom - dtm, np.nan)


def _clamped_window(bounds, transform, width: int, height: int) -> Window | None:
    raw = from_bounds(*bounds, transform=transform).round_offsets().round_lengths()
    col_off = max(0, int(raw.col_off))
    row_off = max(0, int(raw.row_off))
    col_end = min(width, int(raw.col_off + raw.width))
    row_end = min(height, int(raw.row_off + raw.height))
    if col_end <= col_off or row_end <= row_off:
        return None
    return Window(col_off, row_off, col_end - col_off, row_end - row_off)


def footprint_surface_stats(
    feature: dict,
    delta: np.ndarray,
    transform,
) -> dict | None:
    raw_polygon = feature.get("polygon")
    if not isinstance(raw_polygon, list) or len(raw_polygon) < 4:
        return None
    polygon = Polygon(raw_polygon)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty or polygon.area <= 1.0:
        return None

    # Remove a narrow edge band when possible. DSM cells at footprint boundaries
    # can mix facade/terrain/tree returns; a 0.75 m erosion makes the estimator
    # more robust without claiming a new footprint.
    interior = polygon.buffer(-0.75)
    sampling_polygon = interior if not interior.is_empty and interior.area >= 4.0 else polygon
    window = _clamped_window(sampling_polygon.bounds, transform, delta.shape[1], delta.shape[0])
    if window is None:
        return None
    row0 = int(window.row_off)
    row1 = row0 + int(window.height)
    col0 = int(window.col_off)
    col1 = col0 + int(window.width)
    subset = delta[row0:row1, col0:col1]
    mask = geometry_mask(
        [mapping(sampling_polygon)],
        out_shape=subset.shape,
        transform=window_transform(window, transform),
        invert=True,
        all_touched=False,
    )
    values = subset[mask]
    values = values[np.isfinite(values)]
    # Negative values are retained in global diagnostics but are not credible
    # building-above-ground samples.
    credible = values[(values >= 0.5) & (values <= 80.0)]
    if credible.size < 4:
        return None
    quantiles = np.percentile(credible, [10, 25, 50, 75, 90, 95, 99])
    return {
        "sample_count": int(credible.size),
        "footprint_area_m2": float(polygon.area),
        "sampling_area_m2": float(sampling_polygon.area),
        "edge_erosion_m": 0.75 if sampling_polygon is interior else 0.0,
        "p10": float(quantiles[0]),
        "p25": float(quantiles[1]),
        "p50": float(quantiles[2]),
        "p75": float(quantiles[3]),
        "p90": float(quantiles[4]),
        "p95": float(quantiles[5]),
        "p99": float(quantiles[6]),
        "min": float(np.min(credible)),
        "max": float(np.max(credible)),
        "roof_relief_p95_p25": float(quantiles[5] - quantiles[1]),
    }


def metric_summary(errors: list[float]) -> dict | None:
    if not errors:
        return None
    absolute = np.abs(np.asarray(errors, dtype=np.float64))
    signed = np.asarray(errors, dtype=np.float64)
    return {
        "count": len(errors),
        "mae_m": float(np.mean(absolute)),
        "median_ae_m": float(np.median(absolute)),
        "p90_ae_m": float(np.percentile(absolute, 90)),
        "bias_m": float(np.mean(signed)),
        "within_1m_fraction": float(np.mean(absolute <= 1.0)),
        "within_2m_fraction": float(np.mean(absolute <= 2.0)),
        "within_3m_fraction": float(np.mean(absolute <= 3.0)),
    }


def run_proof(work_dir: Path, cache_root: Path) -> dict:
    work_dir.mkdir(parents=True, exist_ok=True)
    dtm_path = work_dir / "nannestad-dtm.tif"
    dom_path = work_dir / "nannestad-dom.tif"
    download(dtm_getcoverage_url(NANNESTAD_TILE), dtm_path)
    download(dom_getcoverage_url(NANNESTAD_TILE), dom_path)

    dtm_validation = validate_dtm(dtm_path, NANNESTAD_TILE)
    dom_validation = validate_dom(dom_path, NANNESTAD_TILE)
    dtm, dom, transform, dtm_nodata, dom_nodata = aligned_grids(dtm_path, dom_path)
    delta = valid_delta(dtm, dom, dtm_nodata, dom_nodata)
    global_values = delta[np.isfinite(delta)]
    if global_values.size != NANNESTAD_TILE.size_m * NANNESTAD_TILE.size_m:
        raise BuildingHeightProofError(
            f"expected complete 1 m DTM/DOM overlap, got {global_values.size} valid cells"
        )

    building_result, artifact = compile_buildings(cache_root)
    candidates: list[dict] = []
    calibration_errors = {key: [] for key in ESTIMATORS}
    calibration_by_source: dict[str, dict[str, list[float]]] = {}
    for feature in artifact.get("features", []):
        stats = footprint_surface_stats(feature, delta, transform)
        if stats is None:
            continue
        record = {
            "source_id": feature.get("source_id"),
            "building": feature.get("building"),
            "height_m": feature.get("height_m"),
            "height_source": feature.get("height_source"),
            **stats,
        }
        candidates.append(record)
        raw_height = feature.get("height_m")
        if raw_height is None or feature.get("height_source") == "unresolved":
            continue
        source_height = float(raw_height)
        source_key = str(feature.get("height_source") or "unknown")
        bucket = calibration_by_source.setdefault(
            source_key, {key: [] for key in ESTIMATORS}
        )
        for key in ESTIMATORS:
            error = stats[key] - source_height
            calibration_errors[key].append(error)
            bucket[key].append(error)

    if not candidates:
        raise BuildingHeightProofError("DOM-DTM produced no usable building footprint samples")
    calibration = {
        key: metric_summary(errors) for key, errors in calibration_errors.items()
    }
    by_source = {
        source: {key: metric_summary(errors) for key, errors in estimators.items()}
        for source, estimators in sorted(calibration_by_source.items())
    }
    unresolved = [
        record
        for record in candidates
        if record["height_m"] is None or record["height_source"] == "unresolved"
    ]
    global_quantiles = np.percentile(global_values, [1, 10, 50, 90, 99, 99.9])
    return {
        "schema": "nwe.nhm-dom-building-height-proof/0.1",
        "status": "EXPERIMENT_PASS",
        "tile_id": NANNESTAD_TILE.tile_id,
        "horizontal_crs": NANNESTAD_TILE.horizontal_crs,
        "source": {
            "dtm": {
                "request_url": dtm_validation["request_url"],
                "raw_sha256": sha256_path(dtm_path),
                "grid_sha256": dtm_validation["grid_sha256"],
                "min_m": dtm_validation["min_m"],
                "max_m": dtm_validation["max_m"],
            },
            "dom": {
                "request_url": dom_validation["request_url"],
                "raw_sha256": sha256_path(dom_path),
                "grid_sha256": dom_validation["grid_sha256"],
                "min_surface_m": dom_validation["min_surface_m"],
                "max_surface_m": dom_validation["max_surface_m"],
            },
            "grid_alignment": "EXACT_1M_MATCH",
            "building_artifact_sha256": building_result["artifact_sha256"],
            "building_semantic_stats": building_result.get("semantic_stats"),
        },
        "global_dom_minus_dtm": {
            "valid_cell_count": int(global_values.size),
            "p01_m": float(global_quantiles[0]),
            "p10_m": float(global_quantiles[1]),
            "p50_m": float(global_quantiles[2]),
            "p90_m": float(global_quantiles[3]),
            "p99_m": float(global_quantiles[4]),
            "p99_9_m": float(global_quantiles[5]),
            "max_m": float(np.max(global_values)),
            "cells_over_2m": int(np.count_nonzero(global_values >= 2.0)),
            "cells_over_5m": int(np.count_nonzero(global_values >= 5.0)),
        },
        "building_sampling": {
            "compiled_buildings": int(building_result["compiled_count"]),
            "usable_dom_dtm_candidates": len(candidates),
            "unresolved_height_candidates": len(unresolved),
            "source_height_calibration_count": sum(
                1
                for record in candidates
                if record["height_m"] is not None and record["height_source"] != "unresolved"
            ),
            "edge_erosion_policy": "0.75m-when-result-area-at-least-4m2",
            "credible_delta_range_m": [0.5, 80.0],
        },
        "calibration": calibration,
        "calibration_by_height_source": by_source,
        "candidate_summary": {
            "p50_median": float(np.median([item["p50"] for item in candidates])),
            "p90_median": float(np.median([item["p90"] for item in candidates])),
            "p95_median": float(np.median([item["p95"] for item in candidates])),
            "roof_relief_median": float(
                np.median([item["roof_relief_p95_p25"] for item in candidates])
            ),
        },
        "candidates": candidates,
        "decision": {
            "production_selected": False,
            "runtime_building_heights_changed": False,
            "next_gate": (
                "select/reject a DOM-DTM estimator only after calibration metrics and "
                "source-height provenance classes are reviewed"
            ),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = run_proof(args.work_dir, args.cache_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "status": result["status"],
                "tile_id": result["tile_id"],
                "building_sampling": result["building_sampling"],
                "calibration": result["calibration"],
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
    except BuildingHeightProofError as exc:
        print(f"NWE_NHM_DOM_BUILDING_PROOF_REJECTED: {exc}", file=__import__("sys").stderr)
        raise SystemExit(1)
