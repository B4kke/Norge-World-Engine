from __future__ import annotations

import pytest

from nwe_compiler.nhm_mosaic_authority import NHMMosaicAuthorityError, assess_nhm_mosaic_authority


def _service(*, sort_field: str = "NAME", sort_field_type: str = "esriFieldTypeString") -> dict:
    return {
        "name": "NHM_DTM_25833",
        "spatialReference": {"wkid": 25833, "latestWkid": 25833},
        "pixelSizeX": 1.0,
        "pixelSizeY": 1.0,
        "pixelType": "F32",
        "defaultMosaicMethod": "ByAttribute",
        "allowedMosaicMethods": "ByAttribute,NorthWest,LockRaster",
        "sortField": sort_field,
        "sortValue": "0" if sort_field_type == "esriFieldTypeString" else 0,
        "sortAscending": True,
        "mosaicOperator": "First",
        "defaultResamplingMethod": "Bilinear",
        "fields": [
            {"name": "OBJECTID", "type": "esriFieldTypeOID"},
            {"name": "NAME", "type": "esriFieldTypeString"},
            {"name": sort_field, "type": sort_field_type},
        ],
    }


def _feature(object_id: int, name: str, *, bottom: float, top: float) -> dict:
    return {
        "attributes": {
            "OBJECTID": object_id,
            "NAME": name,
            "MINPS": 0,
            "MAXPS": 10,
            "LOWPS": 1,
            "HIGHPS": 8,
            "CATEGORY": 1,
            "ZORDER": -300,
        },
        "geometry": {
            "rings": [
                [
                    [275425, bottom],
                    [275425, top],
                    [290435, top],
                    [290435, bottom],
                    [275425, bottom],
                ]
            ],
            "spatialReference": {"wkid": 25833, "latestWkid": 25833},
        },
    }


def _seam_features() -> list[dict]:
    return [
        _feature(854, "33-125-116", bottom=6665995, top=6681005),
        _feature(855, "33-125-117", bottom=6680995, top=6696005),
    ]


def test_real_shape_evidence_confirms_logical_tiles_but_keeps_authority_fail_closed():
    result = assess_nhm_mosaic_authority(_service(), _seam_features())

    assert result["logical_atom_tile_name_link_confirmed"] is True
    assert result["raw_byte_identity_confirmed"] is False
    assert result["overlap"] == {
        "bounds": [275425.0, 6680995.0, 290435.0, 6681005.0],
        "width_m": 15010.0,
        "height_m": 10.0,
    }
    assert result["service"]["default_mosaic_method"] == "ByAttribute"
    assert result["service"]["mosaic_operator"] == "First"
    assert result["service"]["sort_field"] == "NAME"
    assert result["service"]["sort_field_type"] == "esriFieldTypeString"
    assert result["service"]["sort_field_supported_by_documented_byattribute_semantics"] is False
    assert result["production_transform_authorized"] is False
    assert result["authority_status"] == "FAIL_CLOSED_UNPROVEN"
    assert "byattribute_sort_field_type_is_outside_documented_numeric_or_date_semantics" in result["blockers"]


def test_even_documented_numeric_ordering_is_not_enough_to_authorize_atom_seam():
    service = _service(sort_field="PRIORITY", sort_field_type="esriFieldTypeInteger")
    result = assess_nhm_mosaic_authority(service, _seam_features())

    assert result["service"]["sort_field_supported_by_documented_byattribute_semantics"] is True
    assert "byattribute_sort_field_type_is_outside_documented_numeric_or_date_semantics" not in result["blockers"]
    assert "image_service_catalog_name_and_geometry_do_not_prove_byte_identity_with_atom_geotiff" in result["blockers"]
    assert "provider_has_not_published_scope_statement_making_imageserver_default_rule_authoritative_for_atom_overlap" in result["blockers"]
    assert result["production_transform_authorized"] is False


def test_missing_expected_tile_fails_closed():
    with pytest.raises(NHMMosaicAuthorityError, match="missing expected NHM catalog items"):
        assess_nhm_mosaic_authority(_service(), _seam_features()[:1])
