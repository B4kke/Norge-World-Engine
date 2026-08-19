import pytest

from nwe_compiler.dtm1_nhm_update_scope import (
    Dtm1NhmUpdateScopeError,
    NhmUpdateSurfaceEvidence,
    classify_nhm_update_surface,
    current_provider_dtm_wms_scope,
)


def test_current_provider_wms_scope_is_useful_but_fail_closed_for_dtm1():
    result = current_provider_dtm_wms_scope()
    assert result["nhm_update_semantics_supported"] is True
    assert result["authorizes_downloadable_dtm1_overlap"] is False
    assert result["production_seam_authority"] is False
    assert result["authority_status"] == "UNPROVEN"
    assert result["evidence"]["latest_project_basis"] == "projects_that_update_national_height_model"


def test_latest_project_claim_requires_explicit_basis():
    with pytest.raises(Dtm1NhmUpdateScopeError, match="explicit basis"):
        classify_nhm_update_surface(
            NhmUpdateSurfaceEvidence(
                provider="Statens kartverk",
                surface="test",
                states_latest_project_displayed=True,
                latest_project_basis=None,
                states_projects_update_nhm=True,
                downloadable_dtm1_source_bound=False,
                explicit_dtm1_overlap_rule=False,
                provenance_fields=("provider_metadata_snapshot_sha256",),
            )
        )


def test_wms_semantics_cannot_be_promoted_without_downloadable_dtm1_binding():
    with pytest.raises(Dtm1NhmUpdateScopeError, match="downloadable-DTM1 source binding"):
        classify_nhm_update_surface(
            NhmUpdateSurfaceEvidence(
                provider="Statens kartverk",
                surface="Digital terrengmodell WMS",
                states_latest_project_displayed=True,
                latest_project_basis="projects_that_update_national_height_model",
                states_projects_update_nhm=True,
                downloadable_dtm1_source_bound=False,
                explicit_dtm1_overlap_rule=True,
                provenance_fields=("provider_metadata_snapshot_sha256",),
            )
        )


def test_future_source_bound_overlap_contract_can_be_represented_explicitly():
    result = classify_nhm_update_surface(
        NhmUpdateSurfaceEvidence(
            provider="Statens kartverk",
            surface="hypothetical documented DTM1 generation contract",
            states_latest_project_displayed=True,
            latest_project_basis="projects_that_update_national_height_model",
            states_projects_update_nhm=True,
            downloadable_dtm1_source_bound=True,
            explicit_dtm1_overlap_rule=True,
            provenance_fields=("provider_contract_sha256", "source_family", "overlap_rule"),
        )
    )
    assert result["authorizes_downloadable_dtm1_overlap"] is True
    assert result["production_seam_authority"] is True
    assert result["authority_status"] == "PROVEN"
