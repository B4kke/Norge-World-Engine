from __future__ import annotations

import pytest

from nwe_compiler.nhm_wcs_source_candidate import (
    WCS_COVERAGE,
    WCS_DATASET_ID,
    WCS_SERVICE_METADATA_UUID,
)
from nwe_compiler.nhm_wcs_vertical_authority import (
    KARTVERKET_LAND_HEIGHT_REFERENCE_URL,
    NhmWcsVerticalAuthorityError,
    vertical_datum_authority_contract,
)


def test_known_nhm_wcs_identity_supports_nn2000_datum_binding_only():
    contract = vertical_datum_authority_contract()

    assert contract["vertical_datum"] == "NN2000"
    assert contract["z_semantics"] == "normal_height_m"
    assert contract["authority"]["url"] == KARTVERKET_LAND_HEIGHT_REFERENCE_URL
    assert contract["authority"]["scope"] == "official geographic land-height data"
    assert contract["service"]["service_metadata_uuid"] == WCS_SERVICE_METADATA_UUID
    assert contract["service"]["dataset_id"] == WCS_DATASET_ID
    assert contract["service"]["coverage"] == WCS_COVERAGE
    assert contract["evidence"]["datum_binding_supported"] is True
    assert contract["evidence"]["getcoverage_vertical_crs_explicit"] is False
    assert contract["evidence"]["production_source_selected"] is False
    assert contract["evidence"]["task_queue_reconciled"] is False
    assert contract["authority_status"] == "DATUM_BINDING_SUPPORTED_SOURCE_SELECTION_OPEN"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("service_metadata_uuid", "wrong-service"),
        ("dataset_id", "wrong-dataset"),
        ("coverage", "wrong-coverage"),
        ("horizontal_crs", "EPSG:25833"),
    ],
)
def test_vertical_datum_authority_fails_closed_outside_exact_service_scope(field: str, value: str):
    kwargs = {
        "service_metadata_uuid": WCS_SERVICE_METADATA_UUID,
        "dataset_id": WCS_DATASET_ID,
        "coverage": WCS_COVERAGE,
        "horizontal_crs": "EPSG:25832",
    }
    kwargs[field] = value

    with pytest.raises(NhmWcsVerticalAuthorityError, match="scoped only to the known NHM DTM 25832 WCS identity"):
        vertical_datum_authority_contract(**kwargs)
