import pytest

from nwe_compiler.dtm1_nhm_metadata_surface import (
    Dtm1NhmMetadataSurfaceError,
    assess_nhm_metadata_surface,
)


LAYERS = {
    "Bestilt punktetthet",
    "NHM prosjektalder",
    "NHM prosjektdekning",
    "prioritet 1",
    "prioritet 2",
    "prioritet 3",
    "Prosjekttype",
}


def test_machine_readable_priority_surface_is_evidence_not_seam_authority():
    result = assess_nhm_metadata_surface(
        service_is_machine_readable_project_metadata=True,
        advertised_layers=LAYERS,
    )

    evidence = result["evidence"]
    assert result["schema"] == "nwe.dtm1-nhm-metadata-surface/0.1"
    assert evidence["candidate_priority_metadata_present"] is True
    assert evidence["priority_layers_present"] is True
    assert evidence["authorizes_overlap_winner"] is False
    assert evidence["production_seam_authority"] is False
    assert evidence["authority_status"] == "UNPROVEN"


def test_missing_priority_layer_fails_closed():
    with pytest.raises(Dtm1NhmMetadataSurfaceError, match="prioritet 3"):
        assess_nhm_metadata_surface(
            service_is_machine_readable_project_metadata=True,
            advertised_layers=LAYERS - {"prioritet 3"},
        )


def test_priority_semantics_flag_does_not_silently_authorize_seam():
    result = assess_nhm_metadata_surface(
        service_is_machine_readable_project_metadata=True,
        advertised_layers=LAYERS,
        priority_semantics_documented_for_dtm1_seams=True,
    )

    assert result["evidence"]["priority_semantics_documented_for_dtm1_seams"] is True
    assert result["evidence"]["production_seam_authority"] is False
    assert "separate versioned" not in result["claim_calibration"]["fact"].lower()


def test_invalid_layer_container_is_rejected():
    with pytest.raises(Dtm1NhmMetadataSurfaceError):
        assess_nhm_metadata_surface(
            service_is_machine_readable_project_metadata=True,
            advertised_layers=["NHM prosjektdekning"],  # type: ignore[arg-type]
        )
