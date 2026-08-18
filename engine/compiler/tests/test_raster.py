from math import ceil
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin

from nwe_compiler.raster import (
    RasterContractError,
    file_sha256,
    inspect_raster,
    normalize_dtm_clip,
    warp_dtm_to_canonical_grid,
)


def _fixture(path: Path):
    data = np.arange(400, dtype="float32").reshape((20, 20))
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=20,
        height=20,
        count=1,
        dtype="float32",
        crs="EPSG:25832",
        transform=from_origin(611000, 6678020, 1, 1),
        nodata=-9999.0,
    ) as dst:
        dst.write(data, 1)


def _utm33_fixture_for_utm32_bounds(path: Path, bounds: tuple[float, float, float, float]):
    transformer = Transformer.from_crs("EPSG:25832", "EPSG:25833", always_xy=True)
    left, bottom, right, top = bounds
    points = [transformer.transform(x, y) for x in (left, right) for y in (bottom, top)]
    min_x = min(point[0] for point in points) - 20.0
    max_x = max(point[0] for point in points) + 20.0
    min_y = min(point[1] for point in points) - 20.0
    max_y = max(point[1] for point in points) + 20.0
    width = ceil(max_x - min_x)
    height = ceil(max_y - min_y)

    yy, xx = np.mgrid[0:height, 0:width]
    # Continuous synthetic terrain surface: deterministic and sensitive to
    # interpolation, unlike a constant raster.
    data = (180.0 + xx * 0.015 + yy * 0.025).astype("float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=from_origin(min_x, max_y, 1, 1),
        nodata=-9999.0,
    ) as dst:
        dst.write(data, 1)


def test_pixel_aligned_clip_is_repeatable(tmp_path: Path):
    source = tmp_path / "source.tif"
    output_a = tmp_path / "a.tif"
    output_b = tmp_path / "b.tif"
    _fixture(source)
    bounds = (611005.0, 6678005.0, 611015.0, 6678015.0)

    meta_a = normalize_dtm_clip(source, output_a, bounds)
    meta_b = normalize_dtm_clip(source, output_b, bounds)

    assert meta_a.width == 10 and meta_a.height == 10
    assert meta_a.crs == "EPSG:25832"
    assert meta_a.bounds == bounds
    assert file_sha256(output_a) == file_sha256(output_b)
    assert inspect_raster(output_a).nodata == -9999.0


def test_explicit_utm33_to_utm32_warp_is_fixed_grid_and_repeatable(tmp_path: Path):
    bounds = (611000.0, 6677000.0, 611100.0, 6677100.0)
    source = tmp_path / "source-25833.tif"
    output_a = tmp_path / "warp-a.tif"
    output_b = tmp_path / "warp-b.tif"
    _utm33_fixture_for_utm32_bounds(source, bounds)

    meta_a = warp_dtm_to_canonical_grid(source, output_a, bounds)
    meta_b = warp_dtm_to_canonical_grid(source, output_b, bounds)

    assert meta_a.crs == "EPSG:25832"
    assert meta_a.width == 100 and meta_a.height == 100
    assert meta_a.bounds == bounds
    assert meta_a.pixel_size == (1.0, 1.0)
    assert meta_a.dtype == "float32"
    assert meta_a.nodata == -9999.0
    assert file_sha256(output_a) == file_sha256(output_b)

    with rasterio.open(output_a) as dataset:
        values = dataset.read(1)
        assert np.isfinite(values[values != dataset.nodata]).all()
        assert np.count_nonzero(values != dataset.nodata) > values.size * 0.95
        assert dataset.tags()["NWE_RESAMPLING"] == "bilinear"
        assert dataset.tags()["NWE_SOURCE_CRS"] == "EPSG:25833"
        assert dataset.tags()["NWE_TARGET_CRS"] == "EPSG:25832"


def test_explicit_warp_rejects_wrong_source_crs(tmp_path: Path):
    source = tmp_path / "source-25832.tif"
    _fixture(source)
    with pytest.raises(RasterContractError, match="expected warp source EPSG:25833"):
        warp_dtm_to_canonical_grid(
            source,
            tmp_path / "bad.tif",
            (611000.0, 6678000.0, 611010.0, 6678010.0),
        )
