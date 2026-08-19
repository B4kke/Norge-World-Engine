import pytest

from nwe_compiler.dtm1_provider_edge_domain import (
    Dtm1ProviderEdgeDomainError,
    assess_provider_edge_domain,
)


def _current_evidence(**overrides):
    values = {
        "provider_nominal_tile_m": 15_000,
        "source_raster_width_px": 15_010,
        "source_raster_height_px": 15_010,
        "pixel_size_m": 1.0,
        "export_maptile_size_m": 15_000,
        "export_maptile_area_m2": 225_000_000,
        "export_original_partition_control_present": True,
        "service_max_image_width_px": 15_000,
        "service_max_image_height_px": 15_000,
    }
    values.update(overrides)
    return assess_provider_edge_domain(**values)


def test_current_provider_signals_support_geometry_but_not_core_clip_authority():
    result = _current_evidence()
    evidence = result["evidence"]
    assert evidence["provider_15000_domain_signals_consistent"] is True
    assert evidence["raster_excess_x_m"] == 10.0
    assert evidence["raster_excess_y_m"] == 10.0
    assert evidence["centered_core_inset_px"] == 5
    assert evidence["explicit_excess_border_semantics_present"] is False
    assert evidence["authorizes_core_clip"] is False
    assert evidence["production_seam_authority"] is False
    assert evidence["authority_status"] == "UNPROVEN"


def test_export_maptile_area_must_equal_15000_square_domain():
    with pytest.raises(Dtm1ProviderEdgeDomainError, match="map-tile area"):
        _current_evidence(export_maptile_area_m2=225_000_001)


def test_export_maptile_size_must_match_nominal_dtm1_tile():
    with pytest.raises(Dtm1ProviderEdgeDomainError, match="map-tile size disagree"):
        _current_evidence(export_maptile_size_m=10_000)


def test_service_15000_limit_is_supporting_signal_not_source_authority():
    result = _current_evidence(
        explicit_excess_border_semantics_present=False,
        explicit_core_domain_authoritative=False,
        explicit_semantics_source_family_bound=False,
    )
    assert result["evidence"]["service_max_image_width_px"] == 15_000
    assert result["evidence"]["service_max_image_height_px"] == 15_000
    assert result["evidence"]["authorizes_core_clip"] is False


def test_explicit_semantics_with_wrong_buffer_conflicts_with_measured_geometry():
    with pytest.raises(Dtm1ProviderEdgeDomainError, match="buffer size conflicts"):
        _current_evidence(
            explicit_excess_border_semantics_present=True,
            explicit_core_domain_authoritative=True,
            explicit_semantics_source_family_bound=True,
            explicit_buffer_per_side_m=4.0,
        )


def test_future_explicit_source_bound_five_metre_buffer_can_authorize_core_clip():
    result = _current_evidence(
        explicit_excess_border_semantics_present=True,
        explicit_core_domain_authoritative=True,
        explicit_semantics_source_family_bound=True,
        explicit_buffer_per_side_m=5.0,
    )
    evidence = result["evidence"]
    assert evidence["authorizes_core_clip"] is True
    assert evidence["production_seam_authority"] is True
    assert evidence["authority_status"] == "PROVEN"


def test_asymmetric_or_fractional_source_excess_fails_closed():
    with pytest.raises(Dtm1ProviderEdgeDomainError, match="symmetric integer-pixel"):
        _current_evidence(source_raster_width_px=15_009)
