import pytest

from nwe_compiler.dtm1_provider_semantics import (
    ProviderSemanticsError,
    classify_provider_semantics,
)


OFFICIAL_EXCERPT = """
Primærdatasettet i FvL er punktskyen, og alle produkt avledes fra denne automatisk.
Dette sikrer en effektiv prosesseringsflyt, men bortfall av manuell editering kan gi visse
artefakter i prosjektgrid og i nasjonale grid.
Terrengmodellene (DTM) generes med primærmetode "Triangulate with Natural Neighbor Interpolation",
og sekundærmetode "Bin with Average Value" om primærmetode feiler.
Denne standarden er gitt ut under norsk lisens for offentlige data (NLOD).
"""


def test_extracts_provider_primary_and_derived_grid_semantics_without_seam_authority():
    result = classify_provider_semantics(OFFICIAL_EXCERPT)
    semantics = result["semantics"]

    assert semantics["pointcloud_is_primary_dataset"] is True
    assert semantics["products_are_derived_automatically"] is True
    assert semantics["national_grid_artifacts_are_explicitly_possible"] is True
    assert semantics["dtm_generation_method_documented"] is True
    assert semantics["nlod_license_documented"] is True
    assert semantics["production_seam_authority"] is False
    assert semantics["authority_status"] == "UNPROVEN"
    assert result["claim_calibration"]["production_seam_authority"] is False


def test_html_markup_is_removed_before_phrase_matching():
    html = OFFICIAL_EXCERPT.replace(
        "Primærdatasettet i FvL er punktskyen",
        "<strong>Primærdatasettet i FvL er punktskyen</strong>",
    )
    result = classify_provider_semantics(html)
    assert result["semantics"]["pointcloud_is_primary_dataset"] is True


def test_near_miss_language_does_not_create_provider_fact():
    result = classify_provider_semantics(
        "Punktsky er viktig. Grid kan avledes. Natural Neighbor. NLOD."
    )
    semantics = result["semantics"]
    assert semantics["pointcloud_is_primary_dataset"] is False
    assert semantics["products_are_derived_automatically"] is False
    assert semantics["national_grid_artifacts_are_explicitly_possible"] is False
    assert semantics["production_seam_authority"] is False


def test_empty_document_fails_closed():
    with pytest.raises(ProviderSemanticsError):
        classify_provider_semantics("   ")
