import pytest

from nwe_compiler.dtm1_seam_evidence_matrix import (
    Dtm1SeamEvidenceError,
    SeamCandidateEvidence,
    assess_seam_candidates,
    current_nannestad_seam_matrix,
)


def test_current_nannestad_matrix_remains_fail_closed():
    result = current_nannestad_seam_matrix()
    assert result["selected_candidate"] is None
    assert result["production_seam_authority"] is False
    assert result["authority_status"] == "UNPROVEN"
    by_name = {item["candidate"]: item for item in result["candidates"]}
    core = by_name["symmetric_5px_core_clip"]
    assert core["deterministic"] is True
    assert core["source_bound"] is True
    assert core["provider_authorized"] is False
    assert "10 m excess" in core["blocker"]
    assert "provider_generation_distribution_contract_sha256" in core["provenance_fields"]
    assert by_name["project_priority"]["discriminating_for_nannestad"] is False


def test_geometry_alone_cannot_promote_core_clip():
    result = assess_seam_candidates(
        [
            SeamCandidateEvidence(
                candidate="core_clip",
                deterministic=True,
                provider_authorized=False,
                source_bound=True,
                discriminating_for_nannestad=True,
                provenance_fields=("core_inset_px",),
                blocker="provider has not authorized border discard",
            )
        ]
    )
    assert result["production_seam_authority"] is False


def test_provider_authorization_without_source_binding_is_rejected():
    with pytest.raises(Dtm1SeamEvidenceError, match="bound to the DTM1 source family"):
        assess_seam_candidates(
            [
                SeamCandidateEvidence(
                    candidate="wrong_scope",
                    deterministic=True,
                    provider_authorized=True,
                    source_bound=False,
                    discriminating_for_nannestad=True,
                    provenance_fields=("rule_version",),
                )
            ]
        )


def test_explicit_source_bound_provider_rule_can_become_candidate_authority():
    result = assess_seam_candidates(
        [
            SeamCandidateEvidence(
                candidate="documented_provider_core_clip",
                deterministic=True,
                provider_authorized=True,
                source_bound=True,
                discriminating_for_nannestad=True,
                provenance_fields=("provider_contract_sha256", "core_inset_px"),
            )
        ]
    )
    assert result["selected_candidate"] == "documented_provider_core_clip"
    assert result["production_seam_authority"] is True
    assert result["authority_status"] == "PROVEN"


def test_multiple_eligible_rules_fail_as_ambiguous():
    eligible = SeamCandidateEvidence(
        candidate="a",
        deterministic=True,
        provider_authorized=True,
        source_bound=True,
        discriminating_for_nannestad=True,
        provenance_fields=("provider_contract_sha256",),
    )
    eligible_b = SeamCandidateEvidence(
        candidate="b",
        deterministic=True,
        provider_authorized=True,
        source_bound=True,
        discriminating_for_nannestad=True,
        provenance_fields=("provider_contract_sha256",),
    )
    with pytest.raises(Dtm1SeamEvidenceError, match="multiple production-eligible"):
        assess_seam_candidates([eligible, eligible_b])
