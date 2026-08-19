import pytest

from nwe_compiler.dtm1_nominal_tile_contract import (
    Dtm1NominalTileContractError,
    derive_nominal_tile_core_candidate,
)


def test_real_dtm1_shape_derives_five_pixel_symmetric_core_candidate():
    result = derive_nominal_tile_core_candidate(
        provider_nominal_tile_size_m=15_000.0,
        raster_width_px=15_010,
        raster_height_px=15_010,
        pixel_size_x_m=1.0,
        pixel_size_y_m=1.0,
        provider_describes_national_model_as_stitched=True,
    )
    candidate = result["candidate"]
    assert candidate["symmetric_inset_x_px"] == 5
    assert candidate["symmetric_inset_y_px"] == 5
    assert candidate["core_width_px"] == 15_000
    assert candidate["core_height_px"] == 15_000
    assert result["claim_calibration"]["production_seam_authority"] is False
    assert result["claim_calibration"]["authorizes_border_discard"] is False


def test_half_pixel_symmetric_inset_is_rejected():
    with pytest.raises(Dtm1NominalTileContractError, match="integer-pixel"):
        derive_nominal_tile_core_candidate(
            provider_nominal_tile_size_m=15_000.0,
            raster_width_px=15_009,
            raster_height_px=15_010,
            pixel_size_x_m=1.0,
            pixel_size_y_m=1.0,
            provider_describes_national_model_as_stitched=True,
        )


def test_missing_provider_stitched_model_premise_fails_closed():
    with pytest.raises(Dtm1NominalTileContractError, match="stitched-national-model"):
        derive_nominal_tile_core_candidate(
            provider_nominal_tile_size_m=15_000.0,
            raster_width_px=15_010,
            raster_height_px=15_010,
            pixel_size_x_m=1.0,
            pixel_size_y_m=1.0,
            provider_describes_national_model_as_stitched=False,
        )


def test_raster_smaller_than_provider_nominal_tile_fails_closed():
    with pytest.raises(Dtm1NominalTileContractError, match="smaller"):
        derive_nominal_tile_core_candidate(
            provider_nominal_tile_size_m=15_000.0,
            raster_width_px=14_999,
            raster_height_px=15_010,
            pixel_size_x_m=1.0,
            pixel_size_y_m=1.0,
            provider_describes_national_model_as_stitched=True,
        )
