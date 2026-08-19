import pytest

from nwe_compiler.dtm1_nhm_generation_distribution_bridge import (
    Dtm1NhmGenerationDistributionBridgeError,
    assess_nhm_generation_distribution_bridge,
)


def _assess(**overrides):
    values = {
        "nhm_update_rule_present": True,
        "fvl_products_derived_automatically": True,
        "project_grid_generalized_to_dtm1": True,
        "nhm_export_accepts_dtm1": True,
        "nhm_export_exposes_original_partition_control": True,
        "dtm1_catalog_binds_generation_to_atom_distribution": True,
        "atom_distribution_nominal_tile_m": 15_000,
    }
    values.update(overrides)
    return assess_nhm_generation_distribution_bridge(**values)


def test_complete_provider_bridge_still_cannot_authorize_core_clip():
    result = _assess()
    evidence = result["evidence"]

    assert evidence["generation_distribution_bridge_supported"] is True
    assert evidence["atom_distribution_nominal_tile_m"] == 15_000
    assert evidence["export_byte_identity_proven"] is False
    assert evidence["authorizes_excess_border_discard"] is False
    assert evidence["production_seam_authority"] is False
    assert evidence["authority_status"] == "UNPROVEN"
    assert "10 m raster excess" in result["claim_calibration"]["remaining_blocker"]


def test_missing_source_family_link_keeps_bridge_incomplete_and_fail_closed():
    result = _assess(dtm1_catalog_binds_generation_to_atom_distribution=False)
    evidence = result["evidence"]

    assert evidence["generation_distribution_bridge_supported"] is False
    assert evidence["authorizes_excess_border_discard"] is False
    assert evidence["production_seam_authority"] is False


def test_non_boolean_provider_evidence_is_rejected():
    with pytest.raises(
        Dtm1NhmGenerationDistributionBridgeError,
        match="provider evidence flags must be booleans",
    ):
        _assess(nhm_export_accepts_dtm1="yes")


def test_nominal_atom_tile_must_match_provider_contract():
    with pytest.raises(
        Dtm1NhmGenerationDistributionBridgeError,
        match="requires a 15000 m nominal Atom tile",
    ):
        _assess(atom_distribution_nominal_tile_m=15_010)
