import pytest

from nwe_compiler.dtm1_raster_grid_crosscheck import (
    RasterGridCrosscheckError,
    classify_raster_grid,
)


def classify(**overrides):
    args = {
        "raster_bounds": (100.0, 200.0, 15110.0, 15210.0),
        "declared_bounds": (99.6, 199.7, 15109.7, 15209.8),
        "catalog_bounds": (100.0, 200.0, 15110.0, 15210.0),
        "raster_width_px": 15010,
        "raster_height_px": 15010,
        "raster_transform": (1.0, 0.0, 100.0, 0.0, -1.0, 15210.0),
        "pixel_size_x_m": 1.0,
        "pixel_size_y_m": -1.0,
        "expected_crs": "EPSG:25833",
        "observed_crs": "EPSG:25833",
    }
    args.update(overrides)
    return classify_raster_grid(**args)


def test_raster_can_match_catalog_without_promoting_authority():
    result = classify()
    assert result["audit"]["classification"] == "RASTER_MATCHES_CATALOG_NOT_DECLARED"
    assert result["claim_calibration"]["production_seam_authority"] is False
    assert result["claim_calibration"]["authority_status"] == "UNPROVEN"
    assert "catalog polygon equality" in result["claim_calibration"]["not_proven"]


def test_matching_declared_and_catalog_is_distinct():
    result = classify(declared_bounds=(100.0, 200.0, 15110.0, 15210.0))
    assert result["audit"]["classification"] == "RASTER_MATCHES_BOTH"


def test_foreign_or_unknown_crs_fails_closed():
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster CRS"):
        classify(observed_crs="EPSG:25832")
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster CRS"):
        classify(observed_crs=None)


def test_unexpected_pixel_size_or_orientation_fails_closed():
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster x pixel size/orientation"):
        classify(pixel_size_x_m=2.0)
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster x pixel size/orientation"):
        classify(pixel_size_x_m=-1.0)
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster y pixel size/orientation"):
        classify(pixel_size_y_m=1.0)


def test_rotated_or_sheared_affine_fails_closed():
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster rotation/shear"):
        classify(raster_transform=(1.0, 0.05, 100.0, 0.0, -1.0, 15210.0))
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster rotation/shear"):
        classify(raster_transform=(1.0, 0.0, 100.0, -0.05, -1.0, 15210.0))


def test_transform_pixel_size_disagreement_fails_closed():
    with pytest.raises(RasterGridCrosscheckError, match="transform disagrees"):
        classify(raster_transform=(0.5, 0.0, 100.0, 0.0, -1.0, 15210.0))


def test_bounds_dimensions_and_affine_must_be_self_consistent():
    with pytest.raises(RasterGridCrosscheckError, match="bounds disagree"):
        classify(raster_width_px=15000)
    with pytest.raises(RasterGridCrosscheckError, match="bounds disagree"):
        classify(raster_transform=(1.0, 0.0, 100.5, 0.0, -1.0, 15210.0))


def test_non_finite_metadata_fails_closed():
    with pytest.raises(RasterGridCrosscheckError, match="finite values"):
        classify(raster_transform=(1.0, 0.0, float("nan"), 0.0, -1.0, 15210.0))
    with pytest.raises(RasterGridCrosscheckError, match="bounds must contain 4 finite values"):
        classify(raster_bounds=(100.0, 200.0, float("inf"), 15210.0))
