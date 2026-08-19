from __future__ import annotations

import hashlib
import struct
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import rasterio

from nwe_compiler.canonical import canonical_bytes
from nwe_compiler.nhm_wcs_source_candidate import NhmWcsCandidateError, validate_getcoverage
from nwe_compiler.terrain_artifacts import MAGIC
from nwe_compiler.tiles import TileSpec


def _quantiles(values: np.ndarray) -> dict[str, float]:
    values = np.asarray(values, dtype="float64")
    values = values[np.isfinite(values)]
    if values.size == 0:
        raise NhmWcsCandidateError("cannot summarize an empty seam metric")
    return {
        "min": float(np.min(values)),
        "p50": float(np.quantile(values, 0.50)),
        "p90": float(np.quantile(values, 0.90)),
        "p95": float(np.quantile(values, 0.95)),
        "p99": float(np.quantile(values, 0.99)),
        "max": float(np.max(values)),
        "mean": float(np.mean(values)),
    }


def _load_valid_grid(path: Path, tile: TileSpec) -> np.ndarray:
    metadata = validate_getcoverage(path, tile)
    if metadata["valid_samples"] != metadata["width"] * metadata["height"]:
        raise NhmWcsCandidateError(
            f"{tile.tile_id}: WCS candidate contains nodata and cannot form a complete runtime tile"
        )
    with rasterio.open(path) as dataset:
        return dataset.read(1, out_dtype="float32")


def experimental_height_grid_identity(path: str | Path, tile: TileSpec) -> dict[str, Any]:
    """Build only the deterministic byte identity of a runtime-shaped height grid.

    No RuntimeVerificationBundle or promotion record is emitted because WCS has
    not been selected as a production terrain source. The bytes intentionally
    use the existing NWE height-grid envelope so the experiment can compare the
    resulting center tile to the accepted Atom-derived artifact without forging
    provenance.
    """
    path = Path(path)
    metadata = validate_getcoverage(path, tile)
    data = _load_valid_grid(path, tile)
    header = {
        "schema": "nwe.terrain-height-grid-artifact/0.1",
        "tile_id": tile.tile_id,
        "horizontal_crs": tile.horizontal_crs,
        "vertical_datum": "NN2000",
        "bounds": list(tile.bounds),
        "width": metadata["width"],
        "height": metadata["height"],
        "pixel_size_m": 1.0,
        "nodata": metadata["nodata"],
        "storage": "float32-le-row-major-north-to-south",
        "elevation_min_m": metadata["min_m"],
        "elevation_max_m": metadata["max_m"],
    }
    header_bytes = canonical_bytes(header)
    grid_bytes = np.asarray(data, dtype="<f4", order="C").tobytes(order="C")
    artifact_bytes = MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + grid_bytes
    return {
        "role": "experimental_runtime_shaped_height_grid_identity_only",
        "tile_id": tile.tile_id,
        "header": header,
        "sha256": hashlib.sha256(artifact_bytes).hexdigest(),
        "byte_size": len(artifact_bytes),
        "sample_count": int(data.size),
        "promotion_record_emitted": False,
        "runtime_verification_bundle_emitted": False,
    }


def _seam_metrics(
    first: np.ndarray,
    second: np.ndarray,
    *,
    orientation: str,
) -> dict[str, Any]:
    if orientation == "east_west":
        if first.shape[0] != second.shape[0] or first.shape[1] < 2 or second.shape[1] < 2:
            raise NhmWcsCandidateError("east/west seam grids have incompatible shapes")
        first_internal = first[:, -1].astype("float64") - first[:, -2].astype("float64")
        second_internal = second[:, 1].astype("float64") - second[:, 0].astype("float64")
        cross = second[:, 0].astype("float64") - first[:, -1].astype("float64")
    elif orientation == "north_south":
        if first.shape[1] != second.shape[1] or first.shape[0] < 2 or second.shape[0] < 2:
            raise NhmWcsCandidateError("north/south seam grids have incompatible shapes")
        # first is south, second is north. Positive direction is northward.
        first_internal = first[0, :].astype("float64") - first[1, :].astype("float64")
        second_internal = second[-2, :].astype("float64") - second[-1, :].astype("float64")
        cross = second[-1, :].astype("float64") - first[0, :].astype("float64")
    else:
        raise NhmWcsCandidateError(f"unknown seam orientation: {orientation}")

    valid = (
        np.isfinite(first_internal)
        & np.isfinite(second_internal)
        & np.isfinite(cross)
    )
    if not np.any(valid):
        raise NhmWcsCandidateError("adjacent WCS tiles have no valid seam samples")
    first_internal = first_internal[valid]
    second_internal = second_internal[valid]
    cross = cross[valid]
    expected = (first_internal + second_internal) / 2.0
    discontinuity = cross - expected
    abs_first = np.abs(first_internal)
    abs_second = np.abs(second_internal)
    abs_cross = np.abs(cross)
    abs_discontinuity = np.abs(discontinuity)
    local_internal_abs_p95 = max(
        float(np.quantile(abs_first, 0.95)),
        float(np.quantile(abs_second, 0.95)),
    )
    cross_abs_p95 = float(np.quantile(abs_cross, 0.95))
    return {
        "valid_samples": int(np.count_nonzero(valid)),
        "cross_1m_step_m": {
            "signed": _quantiles(cross),
            "absolute": _quantiles(abs_cross),
        },
        "first_internal_1m_step_m": {
            "signed": _quantiles(first_internal),
            "absolute": _quantiles(abs_first),
        },
        "second_internal_1m_step_m": {
            "signed": _quantiles(second_internal),
            "absolute": _quantiles(abs_second),
        },
        "cross_discontinuity_after_local_slope_m": {
            "signed": _quantiles(discontinuity),
            "absolute": _quantiles(abs_discontinuity),
        },
        "cross_abs_p95_over_local_internal_abs_p95": (
            cross_abs_p95 / local_internal_abs_p95 if local_internal_abs_p95 > 0 else None
        ),
    }


def analyze_grid_seams(
    tile_paths: dict[str, str | Path],
    tiles: Iterable[TileSpec],
) -> dict[str, Any]:
    tiles = tuple(tiles)
    if not tiles:
        raise NhmWcsCandidateError("at least one WCS tile is required")
    if len({tile.tile_id for tile in tiles}) != len(tiles):
        raise NhmWcsCandidateError("duplicate tile id in WCS seam set")
    if set(tile_paths) != {tile.tile_id for tile in tiles}:
        raise NhmWcsCandidateError("WCS seam paths must exactly match the requested tile set")

    grids = {
        tile.tile_id: _load_valid_grid(Path(tile_paths[tile.tile_id]), tile)
        for tile in tiles
    }
    by_origin = {(tile.bounds[0], tile.bounds[1]): tile for tile in tiles}
    seams: list[dict[str, Any]] = []
    all_abs_discontinuity_p95: list[float] = []
    all_cross_ratio: list[float] = []

    for tile in sorted(tiles, key=lambda item: (item.bounds[1], item.bounds[0])):
        left, bottom, right, top = tile.bounds
        east = by_origin.get((right, bottom))
        if east is not None:
            metrics = _seam_metrics(grids[tile.tile_id], grids[east.tile_id], orientation="east_west")
            seams.append(
                {
                    "orientation": "east_west",
                    "first_tile_id": tile.tile_id,
                    "second_tile_id": east.tile_id,
                    "coordinate_epsg25832": right,
                    **metrics,
                }
            )
        north = by_origin.get((left, top))
        if north is not None:
            metrics = _seam_metrics(grids[tile.tile_id], grids[north.tile_id], orientation="north_south")
            seams.append(
                {
                    "orientation": "north_south",
                    "first_tile_id": tile.tile_id,
                    "second_tile_id": north.tile_id,
                    "coordinate_epsg25832": top,
                    **metrics,
                }
            )

    if not seams:
        raise NhmWcsCandidateError("tile set has no adjacent seams")
    for seam in seams:
        all_abs_discontinuity_p95.append(
            seam["cross_discontinuity_after_local_slope_m"]["absolute"]["p95"]
        )
        ratio = seam["cross_abs_p95_over_local_internal_abs_p95"]
        if ratio is not None:
            all_cross_ratio.append(float(ratio))

    return {
        "schema": "nwe.nhm-wcs-direct-grid-seams/0.1",
        "tile_count": len(tiles),
        "seam_count": len(seams),
        "seams": seams,
        "summary": {
            "seam_discontinuity_abs_p95_m": _quantiles(np.asarray(all_abs_discontinuity_p95)),
            "cross_abs_p95_over_local_internal_abs_p95": (
                _quantiles(np.asarray(all_cross_ratio)) if all_cross_ratio else None
            ),
        },
        "claim_calibration": {
            "measures_direct_runtime_grid_continuity": True,
            "production_source_selected": False,
        },
    }
