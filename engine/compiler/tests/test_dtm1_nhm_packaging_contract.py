import pytest

from nwe_compiler.dtm1_nhm_packaging_contract import (
    Dtm1NhmPackagingContractError,
    assess_nhm_packaging_semantics,
)


def _all_provider_facts():
    return dict(
        national_model_described_as_projects_stitched_together=True,
        export_supports_map_sheet_clipping=True,
        dtm1_download_described_as_map_sheet_grouped=True,
        nhm_metadata_contains_map_sheet_divisions=True,
        nhm_metadata_contains_projects_used_to_generate_model=True,
    )


def test_complete_provider_packaging_evidence_is_supported_but_not_seam_authority():
    result = assess_nhm_packaging_semantics(**_all_provider_facts())
    evidence = result["evidence"]
    assert evidence["packaging_semantics_supported"] is True
    assert evidence["authorizes_overscan_discard"] is False
    assert evidence["authorizes_overlap_winner"] is False
    assert evidence["production_seam_authority"] is False
    assert evidence["authority_status"] == "UNPROVEN"


def test_missing_map_sheet_metadata_keeps_packaging_semantics_incomplete():
    facts = _all_provider_facts()
    facts["nhm_metadata_contains_map_sheet_divisions"] = False
    result = assess_nhm_packaging_semantics(**facts)
    assert result["evidence"]["packaging_semantics_supported"] is False
    assert result["evidence"]["production_seam_authority"] is False


def test_stitched_model_fact_alone_never_authorizes_overlap_winner():
    facts = dict.fromkeys(_all_provider_facts(), False)
    facts["national_model_described_as_projects_stitched_together"] = True
    result = assess_nhm_packaging_semantics(**facts)
    assert result["evidence"]["authorizes_overlap_winner"] is False
    assert result["evidence"]["production_seam_authority"] is False


def test_non_boolean_provider_fact_fails_closed():
    facts = _all_provider_facts()
    facts["export_supports_map_sheet_clipping"] = "yes"
    with pytest.raises(Dtm1NhmPackagingContractError):
        assess_nhm_packaging_semantics(**facts)
