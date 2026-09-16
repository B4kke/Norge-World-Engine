from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_bounds


MODULE_PATH = Path(__file__).parents[1] / "Tools" / "prepare_ground_imagery.py"
SPEC = importlib.util.spec_from_file_location("prepare_ground_imagery", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
imagery = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = imagery
SPEC.loader.exec_module(imagery)


def _write_rgb(path: Path, dtype: str = "uint8") -> None:
    transform = from_bounds(*imagery.TARGET_BOUNDS, 4, 4)
    if dtype == "uint8":
        values = np.array(
            [
                [[10, 20, 30, 40]] * 4,
                [[50, 60, 70, 80]] * 4,
                [[90, 100, 110, 120]] * 4,
            ],
            dtype=np.uint8,
        )
    else:
        values = np.array([[[1000, 2000, 3000, 4000]] * 4] * 3, dtype=np.uint16)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=4,
        height=4,
        count=3,
        dtype=dtype,
        crs=imagery.TARGET_CRS,
        transform=transform,
    ) as target:
        target.write(values)


def test_private_ground_imagery_bakes_exact_tile_and_hash_manifest(tmp_path: Path) -> None:
    source = tmp_path / "source.tif"
    _write_rgb(source)
    output = tmp_path / "ground"
    manifest = imagery.bake_ground_imagery(
        source,
        output,
        source_name="private-fixture",
        rights_basis="test fixture",
        redistribution="private-only",
        output_size=256,
    )
    texture = output / "nannestad_ground_color.png"
    assert texture.is_file()
    assert manifest["schema"] == imagery.SCHEMA
    assert manifest["tile_id"] == imagery.TILE_ID
    assert manifest["bounds"] == list(imagery.TARGET_BOUNDS)
    assert manifest["texture"]["sha256"] == imagery.sha256_path(texture)
    assert manifest["texture"]["width"] == 256
    assert manifest["source"]["redistribution"] == "private-only"
    assert manifest["source"]["raw_source_committed"] is False
    with rasterio.open(texture) as baked:
        assert baked.count == 3
        assert baked.width == baked.height == 256
        assert baked.crs.to_string() == imagery.TARGET_CRS


def test_non_uint8_source_requires_explicit_scale(tmp_path: Path) -> None:
    source = tmp_path / "sentinel-like.tif"
    _write_rgb(source, "uint16")
    with pytest.raises(imagery.GroundImageryError, match="source-value-max"):
        imagery.bake_ground_imagery(
            source,
            tmp_path / "ground",
            source_name="sentinel-like",
            rights_basis="fixture",
            redistribution="allowed-by-license",
            output_size=256,
        )

    manifest = imagery.bake_ground_imagery(
        source,
        tmp_path / "scaled",
        source_name="sentinel-like",
        rights_basis="fixture",
        redistribution="allowed-by-license",
        source_value_max=10000.0,
        output_size=256,
    )
    assert manifest["source"]["source_value_max"] == 10000.0
