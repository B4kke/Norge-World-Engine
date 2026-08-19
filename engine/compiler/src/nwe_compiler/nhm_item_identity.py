from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


class NHMItemIdentityError(RuntimeError):
    pass


_SOURCE_IDENTITY_KEYS = frozenset(
    {
        "uri",
        "sourceuri",
        "sourceurl",
        "sourcepath",
        "path",
        "filepath",
        "filename",
        "rasterpath",
        "sourcedataset",
    }
)


def _capabilities(service: Mapping[str, Any]) -> frozenset[str]:
    raw = service.get("capabilities")
    if not isinstance(raw, str):
        raise NHMItemIdentityError("image service capabilities must be a string")
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


def _response_error_code(value: Any) -> int | None:
    if not isinstance(value, Mapping):
        return None
    error = value.get("error")
    if not isinstance(error, Mapping):
        return None
    code = error.get("code")
    return code if isinstance(code, int) else None


def _identity_fields(value: Any, prefix: str = "") -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            key_text = str(key)
            path = f"{prefix}.{key_text}" if prefix else key_text
            if key_text.casefold() in _SOURCE_IDENTITY_KEYS and isinstance(child, str) and child.strip():
                found.append({"path": path, "value": child.strip()})
            found.extend(_identity_fields(child, path))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for index, child in enumerate(value):
            found.extend(_identity_fields(child, f"{prefix}[{index}]"))
    return found


def assess_nhm_item_identity_surface(
    service: Mapping[str, Any],
    item_surfaces: Sequence[Mapping[str, Any]],
    download_response: Mapping[str, Any],
    *,
    expected_items: Mapping[int, str] | None = None,
) -> dict[str, Any]:
    """Classify whether NHM ImageServer item metadata can prove Atom GeoTIFF byte identity.

    This is deliberately narrower than mosaic/seam authority. A matching catalog
    NAME, raster geometry, raw-file ID or file size is not a cryptographic byte
    identity. The result therefore stays fail-closed unless a future, separately
    versioned proof introduces an exact byte-hash comparison.
    """

    if service.get("name") != "NHM_DTM_25833":
        raise NHMItemIdentityError("expected NHM_DTM_25833 image service")
    capabilities = _capabilities(service)
    expected = dict(expected_items or {854: "33-125-116", 855: "33-125-117"})
    if len(expected) != 2 or len(set(expected.values())) != 2:
        raise NHMItemIdentityError("exactly two distinct expected NHM items are required")

    surfaces_by_id: dict[int, Mapping[str, Any]] = {}
    for surface in item_surfaces:
        object_id = surface.get("object_id")
        name = surface.get("name")
        if not isinstance(object_id, int) or not isinstance(name, str) or not name:
            raise NHMItemIdentityError("item surface requires integer object_id and non-empty name")
        if object_id in surfaces_by_id:
            raise NHMItemIdentityError(f"duplicate item surface {object_id}")
        surfaces_by_id[object_id] = surface

    missing = [object_id for object_id in expected if object_id not in surfaces_by_id]
    if missing:
        raise NHMItemIdentityError(f"missing expected NHM item surfaces: {missing}")

    item_results: list[dict[str, Any]] = []
    exposed_identity_fields: list[dict[str, Any]] = []
    for object_id, expected_name in sorted(expected.items()):
        surface = surfaces_by_id[object_id]
        if surface.get("name") != expected_name:
            raise NHMItemIdentityError(
                f"NHM item {object_id} expected NAME {expected_name!r}, got {surface.get('name')!r}"
            )
        info = surface.get("info")
        key_properties = surface.get("key_properties")
        metadata = surface.get("metadata")
        if not isinstance(info, Mapping) or not isinstance(key_properties, Mapping) or not isinstance(metadata, Mapping):
            raise NHMItemIdentityError(f"NHM item {object_id} requires info/key_properties/metadata mappings")

        item_identity_fields = [
            *({"surface": "info", **field} for field in _identity_fields(info)),
            *({"surface": "key_properties", **field} for field in _identity_fields(key_properties)),
            *({"surface": "metadata", **field} for field in _identity_fields(metadata)),
        ]
        exposed_identity_fields.extend({"object_id": object_id, **field} for field in item_identity_fields)
        item_results.append(
            {
                "object_id": object_id,
                "name": expected_name,
                "pixel_size_m": [info.get("pixelSizeX"), info.get("pixelSizeY")],
                "pixel_type": info.get("pixelType"),
                "metadata_error_code": _response_error_code(metadata),
                "source_identity_fields": item_identity_fields,
            }
        )

    download_error_code = _response_error_code(download_response)
    raster_files = download_response.get("rasterFiles") if isinstance(download_response, Mapping) else None
    download_file_descriptors = []
    if isinstance(raster_files, list):
        for entry in raster_files:
            if not isinstance(entry, Mapping):
                raise NHMItemIdentityError("download rasterFiles entries must be mappings")
            download_file_descriptors.append(
                {
                    "id": entry.get("id"),
                    "size": entry.get("size"),
                    "raster_ids": entry.get("rasterIds"),
                }
            )

    download_capability_advertised = "Download" in capabilities
    download_operation_supported = download_error_code is None and isinstance(raster_files, list)
    blockers = [
        "catalog_item_name_and_geometry_are_logical_identity_not_atom_geotiff_byte_identity",
        "no_cryptographic_byte_comparison_between_imageserver_item_and_atom_geotiff",
    ]
    if not download_capability_advertised:
        blockers.append("imageserver_does_not_advertise_download_capability")
    if not download_operation_supported:
        blockers.append("imageserver_download_rasters_operation_unavailable")
    if not exposed_identity_fields:
        blockers.append("item_info_keyproperties_metadata_expose_no_source_uri_or_file_path")

    return {
        "schema": "nwe.nhm-item-identity-evidence/0.1",
        "role": "diagnostic_source_identity_probe_not_transform_contract",
        "service": {
            "name": service.get("name"),
            "capabilities": sorted(capabilities),
            "download_capability_advertised": download_capability_advertised,
        },
        "items": item_results,
        "logical_atom_tile_name_link_confirmed": True,
        "source_identity_fields_exposed": exposed_identity_fields,
        "download": {
            "operation_supported": download_operation_supported,
            "error_code": download_error_code,
            "file_descriptors": download_file_descriptors,
        },
        "raw_byte_identity_confirmed": False,
        "production_transform_authorized": False,
        "authority_status": "FAIL_CLOSED_UNPROVEN",
        "blockers": blockers,
    }
