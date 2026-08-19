from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.nhm_wcs_source_candidate import (
    NhmWcsCandidateError,
    getcoverage_url,
    source_candidate_contract,
    validate_getcoverage,
)
from nwe_compiler.tiles import prototype_tile


def _write_tiff(path: Path, *, crs: str = "EPSG:25832", left: float = 1000.0, bottom: float = 2000.0, size: int = 4) -> None:
    top = bottom + size
    rows, cols = np.indices((size, size), dtype="float32")
    data = 100.0 + cols * 0.1 + rows * 0.2
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=size,
        height=size,
        count=1,
        dtype="float32",
        crs=crs,
        transform=from_origin(left, top, 1.0, 1.0),
        nodata=-9999.0,
    ) as dataset:
        dataset.write(data, 1)


def test_candidate_contract_is_experimental_not_selected():
    contract = source_candidate_contract()
    evidence = contract["evidence"]
    assert evidence["official_download_service"] is True
    assert evidence["one_metre_grid_supported"] is True
    assert evidence["runtime_crs_direct_match"] is True
    assert evidence["prototype_3x3_experiment_eligible"] is True
    assert evidence["production_source_selected"] is False
    assert evidence["getcoverage_vertical_crs_explicit"] is False


def test_getcoverage_url_matches_exact_runtime_tile_grid():
    tile = prototype_tile(611000, 6677000)
    url = getcoverage_url(tile)
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    assert query["SERVICE"] == ["WCS"]
    assert query["VERSION"] == ["1.0.0"]
    assert query["REQUEST"] == ["GetCoverage"]
    assert query["CRS"] == ["EPSG:25832"]
    assert query["RESPONSE_CRS"] == ["EPSG:25832"]
    assert query["BBOX"] == ["611000,6677000,612000,6678000"]
    assert query["WIDTH"] == ["1000"]
    assert query["HEIGHT"] == ["1000"]
    assert query["FORMAT"] == ["GeoTIFF"]


def test_validate_getcoverage_accepts_exact_one_metre_tile(tmp_path: Path):
    tile = prototype_tile(1000, 2000, 4)
    path = tmp_path / "coverage.tif"
    _write_tiff(path)

    result = validate_getcoverage(path, tile)

    assert result["tile_id"] == tile.tile_id
    assert result["crs"] == "EPSG:25832"
    assert result["bounds"] == [1000.0, 2000.0, 1004.0, 2004.0]
    assert result["pixel_size"] == [1.0, 1.0]
    assert result["width"] == 4
    assert result["height"] == 4
    assert result["valid_samples"] == 16
    assert len(result["response_sha256"]) == 64
    assert len(result["grid_sha256"]) == 64
    assert result["grid_byte_size"] == 16 * 4


def test_validate_getcoverage_rejects_wrong_crs(tmp_path: Path):
    tile = prototype_tile(1000, 2000, 4)
    path = tmp_path / "wrong-crs.tif"
    _write_tiff(path, crs="EPSG:25833")
    with pytest.raises(NhmWcsCandidateError, match="expected EPSG:25832"):
        validate_getcoverage(path, tile)


def test_validate_getcoverage_rejects_wrong_bounds(tmp_path: Path):
    tile = prototype_tile(1000, 2000, 4)
    path = tmp_path / "wrong-bounds.tif"
    _write_tiff(path, left=1001.0)
    with pytest.raises(NhmWcsCandidateError, match="bounds do not match"):
        validate_getcoverage(path, tile)
