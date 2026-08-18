from __future__ import annotations

import pytest

from nwe_compiler.dtm1_extent_crosscheck import (
    ExtentCrosscheckError,
    classify_declared_vs_catalog_extent,
)


def test_catalog_regular_declared_deviation_is_diagnostic_only():
    result = classify_declared_vs_catalog_extent(
        (0.0, 0.0, 15_007.0, 15_013.0),
        (0.0, 0.0, 15_010.0, 15_010.0),
    )

    assert result["audit"]["classification"] == "CATALOG_REGULAR_DECLARED_DEVIATES"
    assert result["audit"]["declared_regular"] is False
    assert result["audit"]["catalog_regular"] is True
    assert result["claim_calibration"]["production_seam_authority"] is False
    assert result["claim_calibration"]["authority_status"] == "UNPROVEN"


def test_both_regular_preserves_center_delta_measurement():
    result = classify_declared_vs_catalog_extent(
        (0.1, -0.1, 15_010.1, 15_009.9),
        (0.0, 0.0, 15_010.0, 15_010.0),
    )

    assert result["audit"]["classification"] == "BOTH_REGULAR"
    assert result["audit"]["declared_center_delta_x_m"] == pytest.approx(0.1)
    assert result["audit"]["declared_center_delta_y_m"] == pytest.approx(-0.1)


def test_both_deviate_does_not_coerce_to_regular_grid():
    result = classify_declared_vs_catalog_extent(
        (0.0, 0.0, 15_006.0, 15_014.0),
        (0.0, 0.0, 15_008.0, 15_012.0),
    )

    assert result["audit"]["classification"] == "BOTH_DEVIATE"
    assert result["audit"]["catalog_regular"] is False
    assert result["claim_calibration"]["production_seam_authority"] is False


def test_invalid_extent_fails_closed():
    with pytest.raises(ExtentCrosscheckError, match="positive width and height"):
        classify_declared_vs_catalog_extent(
            (0.0, 0.0, 0.0, 10.0),
            (0.0, 0.0, 15_010.0, 15_010.0),
        )
