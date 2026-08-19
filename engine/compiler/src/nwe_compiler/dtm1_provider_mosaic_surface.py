from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


class ProviderMosaicSurfaceError(RuntimeError):
    pass


@dataclass(frozen=True)
class MosaicSurfaceObservation:
    service_name: str
    spatial_reference_wkid: int
    pixel_size_x: float
    pixel_size_y: float
    default_mosaic_method: str
    sort_field: str
    sort_field_type: str
    mosaic_operator: str
    default_resampling_method: str


def _field_type(service: dict[str, Any], field_name: str) -> str:
    fields = service.get("fields")
    if not isinstance(fields, list):
        raise ProviderMosaicSurfaceError("service fields must be a list")
    for field in fields:
        if not isinstance(field, dict):
            continue
        if str(field.get("name", "")).casefold() == field_name.casefold():
            field_type = field.get("type")
            if not isinstance(field_type, str) or not field_type:
                raise ProviderMosaicSurfaceError(f"field {field_name!r} has no explicit type")
            return field_type
    raise ProviderMosaicSurfaceError(f"sort field {field_name!r} is not declared by the service")


def _observe(service: dict[str, Any], expected_name: str) -> MosaicSurfaceObservation:
    if not isinstance(service, dict):
        raise ProviderMosaicSurfaceError("service metadata must be an object")
    if service.get("name") != expected_name:
        raise ProviderMosaicSurfaceError(
            f"expected service {expected_name!r}, got {service.get('name')!r}"
        )

    spatial_reference = service.get("spatialReference")
    if not isinstance(spatial_reference, dict):
        raise ProviderMosaicSurfaceError("service spatialReference must be explicit")
    wkid = spatial_reference.get("latestWkid", spatial_reference.get("wkid"))
    if not isinstance(wkid, int):
        raise ProviderMosaicSurfaceError("service WKID must be explicit")

    pixel_size_x = service.get("pixelSizeX")
    pixel_size_y = service.get("pixelSizeY")
    if not isinstance(pixel_size_x, (int, float)) or not isinstance(pixel_size_y, (int, float)):
        raise ProviderMosaicSurfaceError("service pixel size must be numeric")

    default_method = service.get("defaultMosaicMethod")
    sort_field = service.get("sortField")
    operator = service.get("mosaicOperator")
    resampling = service.get("defaultResamplingMethod")
    for label, value in (
        ("defaultMosaicMethod", default_method),
        ("sortField", sort_field),
        ("mosaicOperator", operator),
        ("defaultResamplingMethod", resampling),
    ):
        if not isinstance(value, str) or not value:
            raise ProviderMosaicSurfaceError(f"{label} must be explicit")

    return MosaicSurfaceObservation(
        service_name=expected_name,
        spatial_reference_wkid=wkid,
        pixel_size_x=float(pixel_size_x),
        pixel_size_y=float(pixel_size_y),
        default_mosaic_method=default_method,
        sort_field=sort_field,
        sort_field_type=_field_type(service, sort_field),
        mosaic_operator=operator,
        default_resampling_method=resampling,
    )


def classify_provider_mosaic_surfaces(
    dtm_service: dict[str, Any],
    nhm_dtm_25833_service: dict[str, Any],
) -> dict[str, Any]:
    """Compare provider-owned ImageServer composition surfaces without creating source authority.

    The live Høydedata services are useful provider evidence about how those services
    compose their own rasters. They are not automatically authoritative instructions
    for resolving disagreements between separately downloaded DTM1 GeoTIFF source
    snapshots. This classifier therefore records the service contracts and makes
    endpoint-specific differences explicit while permanently refusing to promote a
    downloadable-raster seam transform from them alone.
    """

    dtm = _observe(dtm_service, "DTM")
    nhm = _observe(nhm_dtm_25833_service, "NHM_DTM_25833")

    dtm_contract_is_explicit = (
        dtm.spatial_reference_wkid == 25833
        and dtm.default_mosaic_method.casefold() == "byattribute"
        and dtm.sort_field.casefold() == "lowps"
        and dtm.sort_field_type == "esriFieldTypeDouble"
        and dtm.mosaic_operator.casefold() == "first"
        and dtm.default_resampling_method.casefold() == "bilinear"
    )
    nhm_contract_is_explicit = (
        nhm.spatial_reference_wkid == 25833
        and nhm.pixel_size_x == 1.0
        and nhm.pixel_size_y == 1.0
        and nhm.default_mosaic_method.casefold() == "byattribute"
        and nhm.sort_field.casefold() == "name"
        and nhm.sort_field_type == "esriFieldTypeString"
        and nhm.mosaic_operator.casefold() == "first"
        and nhm.default_resampling_method.casefold() == "bilinear"
    )
    service_contracts_diverge = (
        dtm.sort_field.casefold() != nhm.sort_field.casefold()
        or dtm.sort_field_type != nhm.sort_field_type
        or dtm.pixel_size_x != nhm.pixel_size_x
        or dtm.pixel_size_y != nhm.pixel_size_y
    )

    return {
        "schema": "nwe.dtm1-provider-mosaic-surface/0.1",
        "dtm": asdict(dtm),
        "nhm_dtm_25833": asdict(nhm),
        "facts": {
            "dtm_service_contract_explicit": dtm_contract_is_explicit,
            "nhm_service_contract_explicit": nhm_contract_is_explicit,
            "service_contracts_diverge": service_contracts_diverge,
        },
        "claim_calibration": {
            "fact": (
                "provider-owned DTM and NHM_DTM_25833 ImageServer surfaces expose distinct "
                "mosaic sort-field contracts"
            ),
            "supported_inference": (
                "mosaic behavior is endpoint-specific and one service policy must not be "
                "silently transferred to downloadable DTM1 overlap resolution"
            ),
            "not_proven": (
                "downloadable DTM1 source priority, 15 km authoritative core, disposable halo, "
                "overlap winner, or production seam transform"
            ),
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
