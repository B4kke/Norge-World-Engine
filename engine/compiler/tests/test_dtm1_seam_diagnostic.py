from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.seam_diagnostic import (
    analyze_raw_overlap,
    compare_mosaic_policies_to_reference,
    compare_normalized_sources_to_reference,
)


def _raster(path: Path, data: np.ndarray, *, left: float, top: float, crs: str = "EPSG:25833", nodata=-32767.0):
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[1],
        height=data.shape[0],
        count=1,
        dtype="float32",
        crs=crs,
        transform=from_origin(left, top, 1, 1),
        nodata=nodata,
    ) as dst:
        dst.write(data.astype("float32"), 1)


def test_raw_overlap_reports_distribution_and_max_location(tmp_path: Path):
    a = np.full((10, 10), 100.0, dtype="float32")
    b = np.full((10, 10), 100.0, dtype="float32")
    b[:, :5] += 0.1
    b[4, 4] = 100.25
    source_a = tmp_path / "a.tif"
    source_b = tmp_path / "b.tif"
    _raster(source_a, a, left=280000, top=6680010)
    _raster(source_b, b, left=280000, top=6680010)

    result = analyze_raw_overlap(source_a, source_b)

    assert result["valid_overlap_pixels"] == 100
    assert result["differing_pixels"] == 50
    assert result["differing_fraction"] == 0.5
    assert result["a_higher_pixels"] == 0
    assert result["b_higher_pixels"] == 50
    assert result["equal_pixels"] == 50
    assert abs(result["absolute_delta_m"]["max"] - 0.25) < 1e-6
    assert result["max_delta_location"]["column"] == 4
    assert result["max_delta_location"]["row"] == 4


def test_reference_comparison_identifies_closer_raw_surface(tmp_path: Path):
    base = np.arange(100, dtype="float32").reshape(10, 10) + 100.0
    source_a = base.copy()
    source_b = base + 0.2
    reference = source_b.copy()
    reference[:, :2] = source_a[:, :2]

    path_a = tmp_path / "a.tif"
    path_b = tmp_path / "b.tif"
    path_ref = tmp_path / "ref.tif"
    for path, data in ((path_a, source_a), (path_b, source_b), (path_ref, reference)):
        _raster(path, data, left=611000, top=6677000, crs="EPSG:25832")

    result = compare_normalized_sources_to_reference(path_a, path_b, path_ref)

    assert result["valid_common_pixels"] == 100
    assert result["closer_source"]["source_a_pixels"] == 20
    assert result["closer_source"]["source_b_pixels"] == 80
    assert result["closer_source"]["equal_distance_pixels"] == 0
    assert result["reference_vs_source_b"]["exact_within_1e-5_pixels"] == 80
    assert result["reference_position_between_raw_surfaces"]["between_0_and_1_fraction"] == 1.0


def test_mosaic_policy_qa_can_identify_interior_margin_owner(tmp_path: Path):
    # Keep the normalized 10x10 comparison grid far from the raw rasters' east/west
    # edges so the intended north/south extent difference is the limiting margin.
    # Raw source A extends two metres farther north; raw source B extends two metres
    # farther south. Their interior margins therefore define an unambiguous split.
    normalized_a = np.full((10, 10), 100.0, dtype="float32")
    normalized_b = np.full((10, 10), 101.0, dtype="float32")

    raw_a = tmp_path / "raw-a.tif"
    raw_b = tmp_path / "raw-b.tif"
    _raster(raw_a, np.full((12, 210), 100.0, dtype="float32"), left=0, top=12)
    _raster(raw_b, np.full((12, 210), 101.0, dtype="float32"), left=0, top=10)

    path_a = tmp_path / "normalized-a.tif"
    path_b = tmp_path / "normalized-b.tif"
    _raster(path_a, normalized_a, left=100, top=10)
    _raster(path_b, normalized_b, left=100, top=10)

    # Target pixel centers y=9.5..0.5. A has the larger raw-raster edge margin in
    # the five northern rows and B in the five southern rows. Build the QA reference
    # from exactly that deterministic policy, then require competing policies to lose.
    reference = normalized_b.copy()
    reference[:5, :] = normalized_a[:5, :]
    path_ref = tmp_path / "reference.tif"
    _raster(path_ref, reference, left=100, top=10)

    result = compare_mosaic_policies_to_reference(raw_a, raw_b, path_a, path_b, path_ref)

    ranking = result["ranking_by_overlap_rmse"]
    assert ranking[0]["policy"] == "max_interior_margin_owner"
    assert ranking[0]["overlap_rmse_m"] == 0.0
    assert result["policies"]["prefer_source_a"]["overlap_only"]["rmse_m"] > 0.0
    assert result["policies"]["prefer_source_b"]["overlap_only"]["rmse_m"] > 0.0
    assert result["policies"]["edge_distance_feather"]["overlap_only"]["rmse_m"] > 0.0
    assert result["role"] == "diagnostic_comparison_only_no_policy_selected"
