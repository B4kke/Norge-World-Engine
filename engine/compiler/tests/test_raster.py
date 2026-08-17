from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.raster import file_sha256, inspect_raster, normalize_dtm_clip


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
