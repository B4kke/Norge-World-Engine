from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence


class NHMMosaicAuthorityError(RuntimeError):
    pass


# ArcGIS REST documents esriMosaicAttribute / ByAttribute as ordering on a
# numeric or date field. Keep this explicit rather than silently inventing
# semantics for provider configurations that advertise a string sort field.
_ARCGIS_BY_ATTRIBUTE_DOCUMENTED_FIELD_TYPES = frozenset(
    {
        "esriFieldTypeSmallInteger",
        "esriFieldTypeInteger",
        "esriFieldTypeSingle",
        "esriFieldTypeDouble",
        "esriFieldTypeDate",
        "esriFieldTypeDateOnly",
        "esriFieldTypeTimeOnly",
        "esriFieldTypeTimestampOffset",
    }
)


@dataclass(frozen=True)
class CatalogItemEvidence:
    object_id: int
    name: str
    category: int
    zorder: int | None
    min_pixel_size: float
    max_pixel_size: float
    bounds: tuple[float, float, float, float]
    spatial_reference_wkid: int


def _field_type(service: Mapping[str, Any], field_name: str) -> str:
    fields = service.get("fields")
    if not isinstance(fields, list):
        raise NHMMosaicAuthorityError("NHM image service fields must be a list")
    for field in fields:
        if not isinstance(field, Mapping):
            continue
        if str(field.get("name", "")).casefold() == field_name.casefold():
            field_type = field.get("type")
            if not isinstance(field_type, str) or not field_type:
                raise NHMMosaicAuthorityError(f"sort field {field_name!r} has no declared ArcGIS field type")
            return field_type
    raise NHMMosaicAuthorityError(f"sort field {field_name!r} is not declared by the image service")


def _ring_bounds(geometry: Mapping[str, Any]) -> tuple[float, float, float, float]:
    rings = geometry.get("rings")
    if not isinstance(rings, list) or not rings:
        raise NHMMosaicAuthorityError("catalog item geometry must contain polygon rings")
    xs: list[float] = []
    ys: list[float] = []
    for ring in rings:
        if not isinstance(ring, list):
            raise NHMMosaicAuthorityError("catalog item ring must be a coordinate list")
        for point in ring:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                raise NHMMosaicAuthorityError("catalog item ring contains an invalid coordinate")
            xs.append(float(point[0]))
            ys.append(float(point[1]))
    if not xs:
        raise NHMMosaicAuthorityError("catalog item geometry is empty")
    return min(xs), min(ys), max(xs), max(ys)


def _catalog_item(feature: Mapping[str, Any]) -> CatalogItemEvidence:
    attributes = feature.get("attributes")
    geometry = feature.get("geometry")
    if not isinstance(attributes, Mapping) or not isinstance(geometry, Mapping):
        raise NHMMosaicAuthorityError("catalog item requires attributes and geometry")
    spatial_reference = geometry.get("spatialReference")
    if not isinstance(spatial_reference, Mapping):
        raise NHMMosaicAuthorityError("catalog item geometry has no spatial reference")
    wkid = spatial_reference.get("latestWkid", spatial_reference.get("wkid"))
    if not isinstance(wkid, int):
        raise NHMMosaicAuthorityError("catalog item geometry has no integer WKID")

    object_id = attributes.get("OBJECTID")
    name = attributes.get("NAME")
    category = attributes.get("CATEGORY")
    if not isinstance(object_id, int) or not isinstance(name, str) or not name:
        raise NHMMosaicAuthorityError("catalog item requires OBJECTID and NAME")
    if not isinstance(category, int):
        raise NHMMosaicAuthorityError(f"catalog item {name!r} requires integer CATEGORY")
    zorder = attributes.get("ZORDER")
    if zorder is not None and not isinstance(zorder, int):
        raise NHMMosaicAuthorityError(f"catalog item {name!r} has invalid ZORDER")

    return CatalogItemEvidence(
        object_id=object_id,
        name=name,
        category=category,
        zorder=zorder,
        min_pixel_size=float(attributes.get("MINPS")),
        max_pixel_size=float(attributes.get("MAXPS")),
        bounds=_ring_bounds(geometry),
        spatial_reference_wkid=wkid,
    )


def _overlap_bounds(items: Sequence[CatalogItemEvidence]) -> tuple[float, float, float, float]:
    if len(items) != 2:
        raise NHMMosaicAuthorityError("the Nannestad authority probe requires exactly two catalog items")
    a, b = items
    left = max(a.bounds[0], b.bounds[0])
    bottom = max(a.bounds[1], b.bounds[1])
    right = min(a.bounds[2], b.bounds[2])
    top = min(a.bounds[3], b.bounds[3])
    if right <= left or top <= bottom:
        raise NHMMosaicAuthorityError("catalog items do not overlap")
    return left, bottom, right, top


def assess_nhm_mosaic_authority(
    service: Mapping[str, Any],
    catalog_features: Iterable[Mapping[str, Any]],
    *,
    expected_source_names: Sequence[str] = ("33-125-116", "33-125-117"),
    expected_wkid: int = 25833,
) -> dict[str, Any]:
    """Classify provider-published NHM mosaic evidence without authorizing a seam.

    This probe deliberately distinguishes a provider service configuration from a
    production TransformContract. Matching catalog names/geometries establish a
    logical source link only; they do not prove byte identity with Atom GeoTIFFs.
    The result stays fail-closed while documented ordering semantics or provider
    authority scope remain ambiguous.
    """

    if len(expected_source_names) != 2 or len(set(expected_source_names)) != 2:
        raise NHMMosaicAuthorityError("exactly two distinct expected source names are required")

    service_name = service.get("name")
    if service_name != "NHM_DTM_25833":
        raise NHMMosaicAuthorityError(f"expected NHM_DTM_25833 service, got {service_name!r}")
    spatial_reference = service.get("spatialReference")
    if not isinstance(spatial_reference, Mapping):
        raise NHMMosaicAuthorityError("NHM image service has no spatialReference")
    service_wkid = spatial_reference.get("latestWkid", spatial_reference.get("wkid"))
    if service_wkid != expected_wkid:
        raise NHMMosaicAuthorityError(f"expected service WKID {expected_wkid}, got {service_wkid!r}")
    if float(service.get("pixelSizeX")) != 1.0 or float(service.get("pixelSizeY")) != 1.0:
        raise NHMMosaicAuthorityError("NHM authority probe requires the advertised 1 m service grid")
    if service.get("pixelType") != "F32":
        raise NHMMosaicAuthorityError(f"expected F32 service pixels, got {service.get('pixelType')!r}")

    default_method = service.get("defaultMosaicMethod")
    operator = service.get("mosaicOperator")
    sort_field = service.get("sortField")
    sort_value = service.get("sortValue")
    sort_ascending = service.get("sortAscending")
    resampling = service.get("defaultResamplingMethod")
    if not isinstance(sort_field, str) or not sort_field:
        raise NHMMosaicAuthorityError("NHM image service has no default mosaic sort field")
    sort_field_type = _field_type(service, sort_field)
    documented_sort_type = sort_field_type in _ARCGIS_BY_ATTRIBUTE_DOCUMENTED_FIELD_TYPES

    items = [_catalog_item(feature) for feature in catalog_features]
    by_name: dict[str, CatalogItemEvidence] = {}
    for item in items:
        if item.name in by_name:
            raise NHMMosaicAuthorityError(f"duplicate NHM catalog item NAME {item.name!r}")
        by_name[item.name] = item
    missing = [name for name in expected_source_names if name not in by_name]
    if missing:
        raise NHMMosaicAuthorityError(f"missing expected NHM catalog items: {missing}")
    selected = [by_name[name] for name in expected_source_names]
    if any(item.spatial_reference_wkid != expected_wkid for item in selected):
        raise NHMMosaicAuthorityError("NHM catalog item CRS does not match the expected service CRS")

    overlap = _overlap_bounds(selected)
    overlap_width = overlap[2] - overlap[0]
    overlap_height = overlap[3] - overlap[1]
    blockers = [
        "image_service_catalog_name_and_geometry_do_not_prove_byte_identity_with_atom_geotiff",
        "provider_has_not_published_scope_statement_making_imageserver_default_rule_authoritative_for_atom_overlap",
    ]
    if default_method != "ByAttribute" or operator != "First":
        blockers.append("published_default_mosaic_rule_is_not_byattribute_first")
    if not documented_sort_type:
        blockers.append("byattribute_sort_field_type_is_outside_documented_numeric_or_date_semantics")

    return {
        "schema": "nwe.nhm-dtm-mosaic-authority-evidence/0.1",
        "role": "diagnostic_authority_probe_not_transform_contract",
        "service": {
            "name": service_name,
            "wkid": service_wkid,
            "pixel_size_m": [float(service.get("pixelSizeX")), float(service.get("pixelSizeY"))],
            "pixel_type": service.get("pixelType"),
            "default_mosaic_method": default_method,
            "mosaic_operator": operator,
            "sort_field": sort_field,
            "sort_field_type": sort_field_type,
            "sort_value": sort_value,
            "sort_ascending": sort_ascending,
            "default_resampling_method": resampling,
            "sort_field_supported_by_documented_byattribute_semantics": documented_sort_type,
        },
        "catalog_items": [
            {
                "object_id": item.object_id,
                "name": item.name,
                "category": item.category,
                "zorder": item.zorder,
                "min_pixel_size": item.min_pixel_size,
                "max_pixel_size": item.max_pixel_size,
                "bounds": list(item.bounds),
                "wkid": item.spatial_reference_wkid,
            }
            for item in selected
        ],
        "logical_atom_tile_name_link_confirmed": True,
        "raw_byte_identity_confirmed": False,
        "overlap": {
            "bounds": list(overlap),
            "width_m": overlap_width,
            "height_m": overlap_height,
        },
        "production_transform_authorized": False,
        "authority_status": "FAIL_CLOSED_UNPROVEN",
        "blockers": blockers,
    }
