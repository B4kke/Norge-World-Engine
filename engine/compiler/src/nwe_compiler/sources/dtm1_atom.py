from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

CANONICALIZATION_ID = "urn:ietf:rfc:8785"
HASH_ALGORITHM = "sha-256"
DTM1_SOURCE_CRS = "EPSG:25833"
DTM1_VERTICAL_DATUM = "NN2000"
DTM1_MEDIA_TYPES = {"application/geotiff", "image/tiff", "image/geotiff"}

from nwe_compiler.spatial import (
    TARGET_EPSG25832,
    DeclaredExtent,
    SpatialContractError,
    declared_extent_covers_target,
    parse_georss_box,
    parse_georss_polygon,
    target_wgs84_polygon,
)

ATOM = "http://www.w3.org/2005/Atom"
GEORSS = "http://www.georss.org/georss"
NS = {"a": ATOM, "g": GEORSS}
BUNDLE_SCHEMA = "nwe.runtime-verification-bundle/0.1"


class FeedError(RuntimeError):
    pass


class UnresolvedSpatialIndex(FeedError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _text(node, path):
    value = node.find(path, NS)
    return value.text.strip() if value is not None and value.text else None


def _links(node):
    return [
        {
            "rel": item.get("rel") or "alternate",
            "href": item.get("href"),
            "type": item.get("type"),
            "hreflang": item.get("hreflang"),
            "title": item.get("title"),
        }
        for item in node.findall("a:link", NS)
        if item.get("href")
    ]


def _categories(node):
    return [
        {"term": item.get("term"), "scheme": item.get("scheme"), "label": item.get("label")}
        for item in node.findall("a:category", NS)
    ]


@dataclass(frozen=True)
class Entry:
    id: str
    title: str
    published: Optional[str]
    updated: Optional[str]
    links: list
    categories: list
    declared_extent: Optional[DeclaredExtent]


def _declared_extent(node) -> Optional[DeclaredExtent]:
    polygon = node.find("g:polygon", NS)
    if polygon is not None and polygon.text:
        try:
            return parse_georss_polygon(polygon.text)
        except SpatialContractError as exc:
            raise FeedError(str(exc)) from exc
    box = node.find("g:box", NS)
    if box is not None and box.text:
        try:
            return parse_georss_box(box.text)
        except SpatialContractError as exc:
            raise FeedError(str(exc)) from exc
    return None


def parse_feed(xml_bytes: bytes) -> list[Entry]:
    root = ET.fromstring(xml_bytes)
    entries = []
    for element in root.findall("a:entry", NS):
        entries.append(
            Entry(
                _text(element, "a:id") or "",
                _text(element, "a:title") or "",
                _text(element, "a:published"),
                _text(element, "a:updated"),
                _links(element),
                _categories(element),
                _declared_extent(element),
            )
        )
    return entries


def relation_href(links: list, preferred=("alternate",)) -> Optional[str]:
    for relation in preferred:
        for item in links:
            if item["rel"] == relation and item["href"]:
                return item["href"]
    return None


def geotiff_href(entry: Entry) -> str:
    """Resolve the concrete DTM1 GeoTIFF link from official Atom metadata.

    The live Kartverket DTM1 feed currently exposes file downloads as
    rel="section" / type="application/geotiff". We accept equivalent TIFF media
    types for defensive interoperability, but never infer the file from entry
    title/id/filename tokens.
    """
    candidates = [
        item
        for item in entry.links
        if item.get("rel") in {"section", "enclosure", "alternate"}
        and str(item.get("type") or "").casefold() in DTM1_MEDIA_TYPES
        and item.get("href")
    ]
    if len(candidates) != 1:
        raise FeedError(f"selected DTM1 entry must expose exactly one GeoTIFF link, got {len(candidates)}")
    return str(candidates[0]["href"])


def select_service_dataset(entries: list[Entry], token: str = "DTM1") -> tuple[Entry, str]:
    matches = [
        entry
        for entry in entries
        if token.casefold()
        in " ".join([entry.id, entry.title] + [str(item.get("term") or "") for item in entry.categories]).casefold()
        and relation_href(entry.links, ("alternate",))
    ]
    if len(matches) != 1:
        raise FeedError(f"expected exactly one explicit service dataset match for {token}, got {len(matches)}")
    href = relation_href(matches[0].links, ("alternate",))
    assert href is not None
    return matches[0], href


def category_crs(entry: Entry) -> list[str]:
    values = []
    for category in entry.categories:
        text = " ".join(str(category.get(key) or "") for key in ("term", "label", "scheme")).upper()
        if "25832" in text or "UTM32" in text or "UTM 32" in text:
            values.append("EPSG:25832")
        if "25833" in text or "UTM33" in text or "UTM 33" in text:
            values.append("EPSG:25833")
    return sorted(set(values))


def select_dataset_entry(
    entries: list[Entry],
    target: tuple[float, float, float, float] = TARGET_EPSG25832,
    required_crs: str = DTM1_SOURCE_CRS,
):
    target_polygon = target_wgs84_polygon(target)
    matches: list[Entry] = []
    unresolved: list[Entry] = []
    for entry in entries:
        if required_crs not in category_crs(entry):
            continue
        if entry.declared_extent is None:
            unresolved.append(entry)
            continue
        if declared_extent_covers_target(entry.declared_extent, target_polygon):
            matches.append(entry)

    if len(matches) == 1:
        selected = matches[0]
        href = geotiff_href(selected)
        return selected, href, target_polygon.bounds, selected.declared_extent
    if len(matches) > 1:
        raise UnresolvedSpatialIndex(f"multiple GeoRSS entries contain target: {len(matches)}")
    if unresolved:
        raise UnresolvedSpatialIndex(
            "UNRESOLVED_SPATIAL_INDEX: "
            f"{len(unresolved)} CRS-compatible entries lack official GeoRSS spatial metadata; "
            "filename/id/title inference forbidden"
        )
    raise FeedError("no CRS-compatible dataset entry geometry covers target")


def canonical_decimal(value: float) -> str:
    decimal = Decimal(str(value)).quantize(Decimal("0.000000000001")).normalize()
    text = format(decimal, "f")
    return "0" if text in ("-0", "-0.0") else text


def spatial_provenance(extent: DeclaredExtent) -> dict:
    if extent.geometry_type == "polygon":
        normalized_geometry = {
            "type": "Polygon",
            "coordinates_lon_lat": [
                [canonical_decimal(x), canonical_decimal(y)] for x, y in extent.geometry.exterior.coords
            ],
        }
    else:
        normalized_geometry = {
            "type": "Box",
            "bounds_lon_lat": [canonical_decimal(value) for value in extent.geometry.bounds],
        }
    payload = {
        "schema": "nwe.spatial-source-metadata/0.1",
        "source_axis_order": "lat_lon",
        "normalized_axis_order": "lon_lat",
        "spatial_geometry_type": extent.geometry_type,
        "spatial_semantics": "extent_declared_by_feed",
        "normalized_geometry": normalized_geometry,
    }
    from nwe_compiler.canonical import canonical_sha256
    return {**payload, "canonical_spatial_hash": canonical_sha256(payload)}


def retrieval_identity(service_url: str, dataset_url: str, entry: Entry, extent: DeclaredExtent) -> dict:
    return {
        "service_feed_url": service_url,
        "dataset_feed_url": dataset_url,
        "dataset_entry_id": entry.id,
        "dataset_entry_href": geotiff_href(entry),
        "dataset_entry_updated": entry.updated,
        "dataset_entry_category_crs": category_crs(entry),
        "spatial": spatial_provenance(extent),
    }


def source_snapshot(
    retrieval: dict,
    raw: bytes,
    metadata: dict,
    *,
    expected_source_crs: str = DTM1_SOURCE_CRS,
    expected_vertical_datum: str = DTM1_VERTICAL_DATUM,
) -> dict:
    required = ("crs", "vertical_datum", "pixel_size", "bounds", "nodata")
    missing = [key for key in required if key not in metadata]
    if missing:
        raise FeedError("source validation missing " + ",".join(missing))
    if metadata["crs"] != expected_source_crs:
        raise FeedError(f"unexpected DTM1 source CRS: expected {expected_source_crs}, got {metadata['crs']}")
    if metadata["vertical_datum"] != expected_vertical_datum:
        raise FeedError(
            f"unexpected DTM1 vertical datum: expected {expected_vertical_datum}, got {metadata['vertical_datum']}"
        )
    return {
        "schema": "nwe.source-snapshot/0.3",
        "source_id": "kartverket:hoyde-dtm1",
        "retrieval_identity": retrieval,
        "raw_sha256": sha256(raw),
        "raw_byte_size": len(raw),
        "source_crs": metadata["crs"],
        "source_vertical_datum": metadata["vertical_datum"],
        "z_semantics": "normal_height_m",
        "pixel_size": [canonical_decimal(float(value)) for value in metadata["pixel_size"]],
        "source_bounds": [canonical_decimal(float(value)) for value in metadata["bounds"]],
        "nodata": canonical_decimal(float(metadata["nodata"])) if metadata["nodata"] is not None else None,
        "license_profile": "CC-BY-4.0",
        "promotion_state": "VALIDATED_SOURCE",
    }


def runtime_verification_bundle_source_stage(source_snapshot_object: dict) -> dict:
    from nwe_compiler.canonical import canonical_sha256
    source_hash = canonical_sha256(source_snapshot_object)
    return {
        "bundle_schema": BUNDLE_SCHEMA,
        "canonicalization_id": CANONICALIZATION_ID,
        "hash_algorithm": HASH_ALGORITHM,
        "stage": "VALIDATED_SOURCE",
        "source_snapshots": [source_snapshot_object],
        "source_snapshot_hashes": [source_hash],
        "decision": "NOT_RUNTIME_READY",
    }
