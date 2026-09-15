from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.nhm_dom_wcs_source_candidate import (
    NhmDomWcsCandidateError,
    WCS_COVERAGE,
    getcoverage_url,
    source_candidate_contract,
    validate_getcoverage,
)
from nwe_compiler.tiles import prototype_tile


def _write_tiff(path: Path, *, crs: str = "EPSG:25832", left: float = 1000.0, bottom: float = 2000.0, size: int = 4) -> None:
    top = bottom + size
    rows, cols = np.indices((size, size), dtype="float32")
    data = 106.0 + cols * 0.15 + rows * 0.25
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


def test_dom_candidate_remains_experimental_and_excludes_hillshade() -> None:
    contract = source_candidate_contract()
    assert contract["service"]["coverage"] == "nhm_dom_topo_25832"
    assert contract["evidence"]["raw_topographic_coverage_selected"] is True
    assert contract["evidence"]["hillshade_coverage_excluded"] is True
    assert contract["evidence"]["prototype_building_surface_experiment_eligible"] is True
    assert contract["evidence"]["production_building_source_selected"] is False


def test_dom_getcoverage_url_matches_exact_nannestad_runtime_grid() -> None:
    tile = prototype_tile(611000, 6677000)
    parsed = urlparse(getcoverage_url(tile))
    query = parse_qs(parsed.query)
    assert query["SERVICE"] == ["WCS"]
    assert query["VERSION"] == ["1.0.0"]
    assert query["REQUEST"] == ["GetCoverage"]
    assert query["COVERAGE"] == [WCS_COVERAGE]
    assert query["CRS"] == ["EPSG:25832"]
    assert query["RESPONSE_CRS"] == ["EPSG:25832"]
    assert query["BBOX"] == ["611000,6677000,612000,6678000"]
    assert query["WIDTH"] == ["1000"]
    assert query["HEIGHT"] == ["1000"]
    assert query["FORMAT"] == ["GeoTIFF"]


def test_dom_validate_getcoverage_accepts_exact_one_metre_tile(tmp_path: Path) -> None:
    tile = prototype_tile(1000, 2000, 4)
    path = tmp_path / "dom.tif"
    _write_tiff(path)
    result = validate_getcoverage(path, tile)
    assert result["crs"] == "EPSG:25832"
    assert result["bounds"] == [1000.0, 2000.0, 1004.0, 2004.0]
    assert result["pixel_size"] == [1.0, 1.0]
    assert result["width"] == result["height"] == 4
    assert result["valid_samples"] == 16
    assert result["z_semantics"] == "surface_elevation_m-provider-grid"
    assert result["vertical_datum_status"] == "not-independently-bound-by-this-candidate"


def test_dom_validate_getcoverage_rejects_wrong_crs(tmp_path: Path) -> None:
    tile = prototype_tile(1000, 2000, 4)
    path = tmp_path / "wrong.tif"
    _write_tiff(path, crs="EPSG:25833")
    with pytest.raises(NhmDomWcsCandidateError, match="expected EPSG:25832"):
        validate_getcoverage(path, tile)
