from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.raster import RasterContractError
from nwe_compiler.terrain_mosaic import warp_dtm_sources_to_canonical_grid

BOUNDS = (280000.0, 6680000.0, 280100.0, 6680100.0)


def _source(path: Path, *, left: float, right: float, value: float) -> None:
    bottom = 6679998.0
    top = 6680102.0
    width = int(right - left)
    height = int(top - bottom)
    data = np.full((height, width), value, dtype="float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=from_origin(left, top, 1, 1),
        nodata=-32767.0,
    ) as dst:
        dst.write(data, 1)


def test_two_source_mosaic_requires_matching_overlap_and_fills_target(tmp_path: Path):
    west = tmp_path / "west.tif"
    east = tmp_path / "east.tif"
    _source(west, left=279998.0, right=280060.0, value=123.25)
    _source(east, left=280040.0, right=280102.0, value=123.25)

    output = tmp_path / "mosaic.tif"
    metadata, metrics = warp_dtm_sources_to_canonical_grid(
        [east, west],
        output,
        BOUNDS,
        target_crs="EPSG:25833",
    )

    assert metadata.width == 100
    assert metadata.height == 100
    assert metadata.bounds == BOUNDS
    assert metrics.source_count == 2
    assert metrics.overlap_pixel_count > 0
    assert metrics.max_overlap_delta_m == 0.0
    with rasterio.open(output) as dataset:
        values = dataset.read(1)
        assert np.all(values == np.float32(123.25))
        tags = dataset.tags()
        assert tags["NWE_TRANSFORM"] == "explicit-source-mosaic-reproject-fixed-grid"
        assert tags["NWE_MOSAIC_SOURCE_COUNT"] == "2"


def test_mosaic_fails_closed_when_raw_overlap_disagrees(tmp_path: Path):
    west = tmp_path / "west.tif"
    east = tmp_path / "east.tif"
    _source(west, left=279998.0, right=280060.0, value=100.0)
    _source(east, left=280040.0, right=280102.0, value=101.0)

    with pytest.raises(RasterContractError, match="source overlap disagrees"):
        warp_dtm_sources_to_canonical_grid(
            [west, east],
            tmp_path / "should-not-pass.tif",
            BOUNDS,
            target_crs="EPSG:25833",
        )


def test_single_source_delegates_to_proven_warp_path(tmp_path: Path):
    source = tmp_path / "single.tif"
    _source(source, left=279998.0, right=280102.0, value=77.0)
    output = tmp_path / "single-output.tif"

    _, metrics = warp_dtm_sources_to_canonical_grid(
        [source],
        output,
        BOUNDS,
        target_crs="EPSG:25833",
    )

    assert metrics.source_count == 1
    assert metrics.overlap_pixel_count == 0
    with rasterio.open(output) as dataset:
        assert dataset.tags()["NWE_TRANSFORM"] == "explicit-reproject-fixed-grid"
