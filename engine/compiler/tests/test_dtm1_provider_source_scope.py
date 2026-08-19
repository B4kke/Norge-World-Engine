import pytest

from nwe_compiler.dtm1_provider_source_scope import (
    ProviderSourceScopeError,
    classify_provider_source_scope,
)


FYSAK_TEXT = """
Kilde: Høyder fra hoydedata_orig
NHM-prosjektdekningsoversikten brukes for å finne nyeste kartleggingsprosjekt innenfor baseområdet.
Aktuelle LAZ-filer for det området beregnes og lastes ned fra serveren.

Høyder fra WCS
WCS-tjenesten Nasjonal høydemodell Digital terrengmodell benyttes som datakilde.
WCS-tjenesten leverer en raster med oppløsningen 1x1 meter.
Denne varianten er vesentlig raskere enn Høyder fra hoydedata_orig, men vil gi lavere nøyaktighet.
"""


def test_fysak_scope_is_classified_without_promoting_seam_authority():
    result = classify_provider_source_scope(FYSAK_TEXT)
    scope = result["scope"]

    assert scope["nhm_project_coverage_selects_newest_for_original_laz"] is True
    assert scope["wcs_is_separate_national_dtm_source"] is True
    assert scope["wcs_resolution_m"] == 1.0
    assert scope["wcs_described_as_lower_accuracy"] is True
    assert scope["newest_project_authorizes_dtm1_overlap_priority"] is False
    assert scope["wcs_authorizes_dtm1_overlap_priority"] is False
    assert scope["production_seam_authority"] is False
    assert scope["authority_status"] == "UNPROVEN"


def test_newest_project_phrase_without_original_laz_scope_does_not_match():
    result = classify_provider_source_scope(
        "NHM-prosjektdekningsoversikten brukes for å finne nyeste kartleggingsprosjekt."
    )
    assert result["scope"]["nhm_project_coverage_selects_newest_for_original_laz"] is False
    assert result["scope"]["production_seam_authority"] is False


def test_wcs_resolution_alone_does_not_make_wcs_source_authority():
    result = classify_provider_source_scope(
        "Høyder fra WCS. WCS-tjenesten leverer en raster med oppløsningen 1x1 meter."
    )
    assert result["scope"]["wcs_resolution_m"] == 1.0
    assert result["scope"]["wcs_is_separate_national_dtm_source"] is False
    assert result["scope"]["wcs_authorizes_dtm1_overlap_priority"] is False


def test_empty_provider_document_fails_closed():
    with pytest.raises(ProviderSourceScopeError):
        classify_provider_source_scope("   ")
