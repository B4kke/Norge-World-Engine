from __future__ import annotations

import pytest

from nwe_compiler.nhm_item_identity import NHMItemIdentityError, assess_nhm_item_identity_surface


def _service(capabilities: str = "Catalog,Image,Metadata") -> dict:
    return {"name": "NHM_DTM_25833", "capabilities": capabilities}


def _surface(object_id: int, name: str, *, metadata: dict | None = None, key_properties: dict | None = None) -> dict:
    return {
        "object_id": object_id,
        "name": name,
        "info": {
            "pixelSizeX": 1,
            "pixelSizeY": 1,
            "pixelType": "F32",
        },
        "key_properties": key_properties
        if key_properties is not None
        else {
            "DatasetTag": "Dataset",
            "ParentRasterType": "Raster Dataset",
            "AREA_OR_POINT": "Area",
            "BandProperties": [{"SourceBandIndex": 0, "BandName": "Band_1"}],
        },
        "metadata": metadata
        if metadata is not None
        else {"error": {"code": 500, "message": "Error retrieving metadata", "details": []}},
    }


def _surfaces() -> list[dict]:
    return [
        _surface(854, "33-125-116"),
        _surface(855, "33-125-117"),
    ]


def test_current_provider_shape_confirms_only_logical_identity():
    result = assess_nhm_item_identity_surface(
        _service(),
        _surfaces(),
        {"error": {"code": 400, "message": "Requested operation is not supported by this service."}},
    )

    assert result["logical_atom_tile_name_link_confirmed"] is True
    assert result["service"]["download_capability_advertised"] is False
    assert result["download"]["operation_supported"] is False
    assert result["download"]["error_code"] == 400
    assert result["source_identity_fields_exposed"] == []
    assert result["raw_byte_identity_confirmed"] is False
    assert result["production_transform_authorized"] is False
    assert result["authority_status"] == "FAIL_CLOSED_UNPROVEN"
    assert "imageserver_does_not_advertise_download_capability" in result["blockers"]
    assert "imageserver_download_rasters_operation_unavailable" in result["blockers"]
    assert "item_info_keyproperties_metadata_expose_no_source_uri_or_file_path" in result["blockers"]


def test_even_download_file_descriptors_do_not_prove_byte_identity():
    result = assess_nhm_item_identity_surface(
        _service("Catalog,Image,Metadata,Download"),
        _surfaces(),
        {
            "rasterFiles": [
                {"id": "33-125-116.tif", "size": 123, "rasterIds": [854]},
                {"id": "33-125-117.tif", "size": 456, "rasterIds": [855]},
            ]
        },
    )

    assert result["service"]["download_capability_advertised"] is True
    assert result["download"]["operation_supported"] is True
    assert result["raw_byte_identity_confirmed"] is False
    assert "no_cryptographic_byte_comparison_between_imageserver_item_and_atom_geotiff" in result["blockers"]


def test_source_uri_visibility_is_evidence_but_not_cryptographic_identity():
    surfaces = _surfaces()
    surfaces[0] = _surface(
        854,
        "33-125-116",
        key_properties={"URI": "/provider/data/33-125-116.tif", "BandProperties": [{"SourceBandIndex": 0}]},
    )
    result = assess_nhm_item_identity_surface(
        _service(),
        surfaces,
        {"error": {"code": 400, "message": "not supported"}},
    )

    assert result["source_identity_fields_exposed"] == [
        {
            "object_id": 854,
            "surface": "key_properties",
            "path": "URI",
            "value": "/provider/data/33-125-116.tif",
        }
    ]
    assert result["raw_byte_identity_confirmed"] is False
    assert "item_info_keyproperties_metadata_expose_no_source_uri_or_file_path" not in result["blockers"]


def test_missing_or_mismatched_expected_item_fails_closed():
    with pytest.raises(NHMItemIdentityError, match="missing expected NHM item surfaces"):
        assess_nhm_item_identity_surface(_service(), _surfaces()[:1], {"error": {"code": 400}})

    wrong = _surfaces()
    wrong[1] = _surface(855, "wrong-name")
    with pytest.raises(NHMItemIdentityError, match="expected NAME"):
        assess_nhm_item_identity_surface(_service(), wrong, {"error": {"code": 400}})
