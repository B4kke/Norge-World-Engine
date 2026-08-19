from __future__ import annotations

from typing import Any

from nwe_compiler.nhm_wcs_source_candidate import (
    VERTICAL_DATUM,
    WCS_COVERAGE,
    WCS_DATASET_ID,
    WCS_SERVICE_METADATA_UUID,
)

KARTVERKET_LAND_HEIGHT_REFERENCE_URL = (
    "https://www.kartverket.no/til-sjos/se-havniva/referanseniva/hva-er-et-referanseniva"
)
KARTVERKET_LAND_HEIGHT_REFERENCE_CLAIM = (
    "official geographic land data with height use the national height system; "
    "NN2000 is the land reference in Norway"
)


class NhmWcsVerticalAuthorityError(RuntimeError):
    pass


def vertical_datum_authority_contract(
    *,
    service_metadata_uuid: str = WCS_SERVICE_METADATA_UUID,
    dataset_id: str = WCS_DATASET_ID,
    coverage: str = WCS_COVERAGE,
    horizontal_crs: str = "EPSG:25832",
) -> dict[str, Any]:
    """Bind NN2000 to the exact official NHM DTM WCS identity without over-promoting it.

    Kartverket's public reference-level guidance states that official geographic
    land-height data use the national height system and identifies NN2000 as the
    current land reference. The WCS service metadata identifies this service as
    the national digital terrain model in EUREF89 / UTM32, but the individual
    GetCoverage GeoTIFF does not advertise a compound vertical CRS.

    This contract therefore supports explicit NN2000 datum binding for the known
    NHM DTM WCS source identity, while deliberately refusing to select WCS as the
    production multi-tile source or to supersede the canonical task-queue gate.
    """
    expected = {
        "service_metadata_uuid": WCS_SERVICE_METADATA_UUID,
        "dataset_id": WCS_DATASET_ID,
        "coverage": WCS_COVERAGE,
        "horizontal_crs": "EPSG:25832",
    }
    actual = {
        "service_metadata_uuid": service_metadata_uuid,
        "dataset_id": dataset_id,
        "coverage": coverage,
        "horizontal_crs": horizontal_crs,
    }
    mismatches = [key for key, value in expected.items() if actual[key] != value]
    if mismatches:
        raise NhmWcsVerticalAuthorityError(
            "vertical datum authority is scoped only to the known NHM DTM 25832 WCS identity: "
            + ",".join(mismatches)
        )

    return {
        "schema": "nwe.nhm-wcs-vertical-datum-authority/0.1",
        "provider": "Statens kartverk",
        "service": actual,
        "vertical_datum": VERTICAL_DATUM,
        "z_semantics": "normal_height_m",
        "authority": {
            "url": KARTVERKET_LAND_HEIGHT_REFERENCE_URL,
            "claim": KARTVERKET_LAND_HEIGHT_REFERENCE_CLAIM,
            "scope": "official geographic land-height data",
        },
        "evidence": {
            "official_national_land_dtm_service": True,
            "provider_land_height_policy_supports_nn2000": True,
            "getcoverage_vertical_crs_explicit": False,
            "datum_binding_supported": True,
            "production_source_selected": False,
            "task_queue_reconciled": False,
        },
        "authority_status": "DATUM_BINDING_SUPPORTED_SOURCE_SELECTION_OPEN",
    }
