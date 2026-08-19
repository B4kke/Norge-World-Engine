import pytest

from nwe_compiler.dtm1_provider_mosaic_surface import (
    ProviderMosaicSurfaceError,
    classify_provider_mosaic_surfaces,
)


def _service(name, pixel, sort_field, sort_type):
    return {
        "name": name,
        "spatialReference": {"wkid": 25833, "latestWkid": 25833},
        "pixelSizeX": pixel,
        "pixelSizeY": pixel,
        "defaultMosaicMethod": "ByAttribute",
        "sortField": sort_field,
        "mosaicOperator": "First",
        "defaultResamplingMethod": "Bilinear",
        "fields": [
            {"name": sort_field, "type": sort_type},
        ],
    }


def test_records_distinct_provider_service_contracts_without_source_authority():
    result = classify_provider_mosaic_surfaces(
        _service("DTM", 0.25, "lowps", "esriFieldTypeDouble"),
        _service("NHM_DTM_25833", 1.0, "NAME", "esriFieldTypeString"),
    )
    assert result["facts"] == {
        "dtm_service_contract_explicit": True,
        "nhm_service_contract_explicit": True,
        "service_contracts_diverge": True,
    }
    assert result["claim_calibration"]["production_seam_authority"] is False
    assert result["claim_calibration"]["authority_status"] == "UNPROVEN"


def test_nhm_near_miss_does_not_pass_explicit_contract():
    result = classify_provider_mosaic_surfaces(
        _service("DTM", 0.25, "lowps", "esriFieldTypeDouble"),
        _service("NHM_DTM_25833", 1.0, "LOWPS", "esriFieldTypeDouble"),
    )
    assert result["facts"]["nhm_service_contract_explicit"] is False
    assert result["claim_calibration"]["production_seam_authority"] is False


def test_unknown_sort_field_type_fails_closed():
    service = _service("NHM_DTM_25833", 1.0, "NAME", "esriFieldTypeString")
    service["fields"] = []
    with pytest.raises(ProviderMosaicSurfaceError):
        classify_provider_mosaic_surfaces(
            _service("DTM", 0.25, "lowps", "esriFieldTypeDouble"),
            service,
        )


def test_unknown_spatial_reference_fails_closed():
    service = _service("DTM", 0.25, "lowps", "esriFieldTypeDouble")
    service["spatialReference"] = {}
    with pytest.raises(ProviderMosaicSurfaceError):
        classify_provider_mosaic_surfaces(
            service,
            _service("NHM_DTM_25833", 1.0, "NAME", "esriFieldTypeString"),
        )
