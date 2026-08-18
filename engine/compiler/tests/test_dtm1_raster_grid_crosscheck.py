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


def test_matching_declared_and_catalog_is_distinct():
    result = classify(declared_bounds=(100.0, 200.0, 15110.0, 15210.0))
    assert result["audit"]["classification"] == "RASTER_MATCHES_BOTH"


def test_foreign_or_unknown_crs_fails_closed():
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster CRS"):
        classify(observed_crs="EPSG:25832")
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster CRS"):
        classify(observed_crs=None)


def test_unexpected_pixel_size_fails_closed():
    with pytest.raises(RasterGridCrosscheckError, match="unexpected raster x pixel size"):
        classify(pixel_size_x_m=2.0)
