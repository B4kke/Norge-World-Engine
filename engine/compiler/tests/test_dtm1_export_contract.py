import pytest

from nwe_compiler.dtm1_export_contract import Dtm1ExportContractError, classify_export_contract


def test_nhm_export_does_not_inherit_project_nonoverlap_control():
    result = classify_export_contract(nhm_mode=1, non_overlapping_projects_documented_for_nhm=0)
    assert result["observation"]["non_overlapping_projects_scope"] == "OUT_OF_SCOPE_FOR_NHM"
    assert result["observation"]["national_grid_seam_authority"] is False
    assert result["claim_calibration"]["production_seam_authority"] is False


def test_project_export_scope_is_observed_without_becoming_national_authority():
    result = classify_export_contract(nhm_mode=0, non_overlapping_projects_documented_for_nhm=0)
    assert result["observation"]["non_overlapping_projects_scope"] == "PROJECT_EXPORT_ONLY"
    assert result["claim_calibration"]["authorizes_source_priority"] is False


def test_unknown_nhm_mode_fails_closed():
    with pytest.raises(Dtm1ExportContractError):
        classify_export_contract(nhm_mode=2, non_overlapping_projects_documented_for_nhm=0)


def test_changed_provider_scope_fails_closed_pending_review():
    with pytest.raises(Dtm1ExportContractError):
        classify_export_contract(nhm_mode=1, non_overlapping_projects_documented_for_nhm=1)
