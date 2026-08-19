from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.dtm1_core_clip_wcs_experiment import compare_core_clip_candidates_to_reference
from nwe_compiler.seam_diagnostic import SeamDiagnosticError


def _write_raw(path: Path, *, top: float) -> None:
    data = np.zeros((12, 12), dtype="float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=12,
        height=12,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=from_origin(0.0, top, 1.0, 1.0),
        nodata=-9999.0,
    ) as dataset:
        dataset.write(data, 1)


def _write_grid(path: Path, data: np.ndarray) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[1],
        height=data.shape[0],
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=from_origin(0.0, 14.0, 1.0, 1.0),
        nodata=-9999.0,
    ) as dataset:
        dataset.write(data.astype("float32"), 1)


def _fixture(tmp_path: Path, *, reference_seam_y: float = 11.0):
    south_raw = tmp_path / "south-raw.tif"
    north_raw = tmp_path / "north-raw.tif"
    _write_raw(south_raw, top=12.0)
    _write_raw(north_raw, top=22.0)

    rows, cols = np.indices((6, 12), dtype="float64")
    ys = 14.0 - (rows + 0.5)
    base = (cols + 0.5) * 0.01 + ys * 0.1

    south = np.full((6, 12), -9999.0, dtype="float32")
    north = np.full((6, 12), -9999.0, dtype="float32")
    south[ys < 12.0] = base[ys < 12.0]
    north[ys >= 10.0] = (base + 1.0)[ys >= 10.0]

    reference = np.where(ys < reference_seam_y, base, base + 1.0).astype("float32")

    south_norm = tmp_path / "south-norm.tif"
    north_norm = tmp_path / "north-norm.tif"
    reference_path = tmp_path / "reference.tif"
    _write_grid(south_norm, south)
    _write_grid(north_norm, north)
    _write_grid(reference_path, reference)
    return south_raw, north_raw, south_norm, north_norm, reference_path


def test_reference_can_identify_symmetric_split(tmp_path: Path):
    args = _fixture(tmp_path, reference_seam_y=11.0)
    result = compare_core_clip_candidates_to_reference(*args, symmetric_inset_px=1)

    assert result["candidate_count"] == 3
    assert result["raw_overlap_m"] == 2
    assert result["best_candidate"]["symmetric"] is True
    assert result["best_candidate"]["rank_by_reference_overlap_rmse"] == 1
    assert result["best_candidate"]["raw_overlap_band_only"]["rmse_m"] == pytest.approx(0.0)
    assert result["symmetric_candidate"]["raw_overlap_band_only"]["exact_within_1e5_pixels"] > 0
    assert result["claim_calibration"]["production_seam_authority"] is False


def test_reference_can_identify_non_symmetric_split_without_promoting_it(tmp_path: Path):
    args = _fixture(tmp_path, reference_seam_y=10.0)
    result = compare_core_clip_candidates_to_reference(*args, symmetric_inset_px=1)

    assert result["best_candidate"]["seam_coordinate_epsg25833"] == 10.0
    assert result["best_candidate"]["symmetric"] is False
    assert result["symmetric_candidate"]["rank_by_reference_overlap_rmse"] > 1
    assert result["claim_calibration"]["wcs_can_promote_source_authority"] is False


def test_requested_inset_must_match_raw_overlap(tmp_path: Path):
    args = _fixture(tmp_path)
    with pytest.raises(SeamDiagnosticError, match="does not match 2 x symmetric inset"):
        compare_core_clip_candidates_to_reference(*args, symmetric_inset_px=2)
