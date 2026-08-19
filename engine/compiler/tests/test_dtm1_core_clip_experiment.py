from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.dtm1_core_clip_experiment import analyze_core_clip_overlap
from nwe_compiler.seam_diagnostic import SeamDiagnosticError


def _write_plane(path: Path, *, top: float, y_offset: float = 0.0) -> None:
    width = height = 12
    transform = from_origin(0.0, top, 1.0, 1.0)
    rows, cols = np.indices((height, width), dtype="float64")
    xs = cols + 0.5
    ys = top - (rows + 0.5)
    values = (0.1 * xs + 0.2 * ys + y_offset).astype("float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=transform,
        nodata=-9999.0,
    ) as dataset:
        dataset.write(values, 1)


def test_symmetric_core_clip_is_smooth_for_one_continuous_plane(tmp_path: Path):
    south = tmp_path / "south.tif"
    north = tmp_path / "north.tif"
    _write_plane(south, top=12.0)
    _write_plane(north, top=22.0)

    result = analyze_core_clip_overlap(south, north, symmetric_inset_px=1)

    assert result["axis"] == "north_south"
    assert result["raw_overlap_m"] == 2
    assert result["candidate_count"] == 3
    symmetric = result["symmetric_candidate"]
    assert symmetric["lower_or_left_source_trim_m"] == 1
    assert symmetric["upper_or_right_source_trim_m"] == 1
    assert symmetric["cross_1m_step_m"]["signed"]["p50"] == pytest.approx(0.2, abs=1e-5)
    assert symmetric["cross_discontinuity_after_local_slope_m"]["absolute"]["max"] < 1e-4


def test_offset_neighbor_is_detected_as_cross_source_discontinuity(tmp_path: Path):
    south = tmp_path / "south.tif"
    north = tmp_path / "north.tif"
    _write_plane(south, top=12.0)
    _write_plane(north, top=22.0, y_offset=1.0)

    result = analyze_core_clip_overlap(south, north, symmetric_inset_px=1)
    symmetric = result["symmetric_candidate"]

    assert symmetric["cross_discontinuity_after_local_slope_m"]["absolute"]["p95"] == pytest.approx(1.0, abs=1e-4)
    assert result["claim_calibration"]["production_seam_authority"] is False


def test_overlap_must_equal_twice_requested_symmetric_inset(tmp_path: Path):
    south = tmp_path / "south.tif"
    north = tmp_path / "north.tif"
    _write_plane(south, top=12.0)
    _write_plane(north, top=21.0)

    with pytest.raises(SeamDiagnosticError, match="does not match 2 x symmetric inset"):
        analyze_core_clip_overlap(south, north, symmetric_inset_px=1)


def test_boolean_inset_is_rejected(tmp_path: Path):
    south = tmp_path / "south.tif"
    north = tmp_path / "north.tif"
    _write_plane(south, top=12.0)
    _write_plane(north, top=22.0)

    with pytest.raises(SeamDiagnosticError, match="non-negative integer"):
        analyze_core_clip_overlap(south, north, symmetric_inset_px=True)
