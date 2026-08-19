from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.nhm_wcs_3x3_candidate import analyze_grid_seams, experimental_height_grid_identity
from nwe_compiler.tiles import prototype_tile


def _write_global_plane(path: Path, tile, *, e_slope: float = 0.01, n_slope: float = 0.02, offset: float = 0.0) -> None:
    size = int(tile.size_m)
    left, bottom, _, top = tile.bounds
    rows, cols = np.indices((size, size), dtype="float64")
    eastings = left + cols + 0.5
    northings = top - rows - 0.5
    data = (100.0 + eastings * e_slope + northings * n_slope + offset).astype("float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=size,
        height=size,
        count=1,
        dtype="float32",
        crs="EPSG:25832",
        transform=from_origin(left, top, 1.0, 1.0),
        nodata=-9999.0,
    ) as dataset:
        dataset.write(data, 1)


def test_continuous_2x2_plane_has_four_normal_adjacent_seams(tmp_path: Path):
    tiles = (
        prototype_tile(1000, 2000, 4),
        prototype_tile(1004, 2000, 4),
        prototype_tile(1000, 2004, 4),
        prototype_tile(1004, 2004, 4),
    )
    paths = {}
    for tile in tiles:
        path = tmp_path / f"{tile.tile_id}.tif"
        _write_global_plane(path, tile)
        paths[tile.tile_id] = path

    result = analyze_grid_seams(paths, tiles)

    assert result["tile_count"] == 4
    assert result["seam_count"] == 4
    for seam in result["seams"]:
        assert seam["valid_samples"] == 4
        assert seam["cross_discontinuity_after_local_slope_m"]["absolute"]["max"] < 1e-4
        assert seam["cross_abs_p95_over_local_internal_abs_p95"] == pytest.approx(1.0, abs=1e-3)


def test_offset_neighbor_is_detected_as_artificial_seam(tmp_path: Path):
    west = prototype_tile(1000, 2000, 4)
    east = prototype_tile(1004, 2000, 4)
    west_path = tmp_path / "west.tif"
    east_path = tmp_path / "east.tif"
    _write_global_plane(west_path, west)
    _write_global_plane(east_path, east, offset=1.0)

    result = analyze_grid_seams(
        {west.tile_id: west_path, east.tile_id: east_path},
        (west, east),
    )
    seam = result["seams"][0]
    assert seam["orientation"] == "east_west"
    assert seam["cross_discontinuity_after_local_slope_m"]["absolute"]["p95"] == pytest.approx(1.0, abs=1e-4)


def test_experimental_identity_is_repeatable_and_not_a_promotion(tmp_path: Path):
    tile = prototype_tile(1000, 2000, 4)
    path = tmp_path / "tile.tif"
    _write_global_plane(path, tile)

    first = experimental_height_grid_identity(path, tile)
    second = experimental_height_grid_identity(path, tile)

    assert first == second
    assert len(first["sha256"]) == 64
    assert first["sample_count"] == 16
    assert first["promotion_record_emitted"] is False
    assert first["runtime_verification_bundle_emitted"] is False
