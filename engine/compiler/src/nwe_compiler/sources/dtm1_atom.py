from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from decimal import Decimal
from itertools import combinations
from typing import Optional

from shapely.ops import unary_union

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


@dataclass(frozen=True)
class DatasetSourceSelection:
    entry: Entry
    href: str
    extent: DeclaredExtent


@dataclass(frozen=True)
class DatasetSourcePlan:
    target_wgs84_bounds: tuple[float, float, float, float]
    sources: tuple[DatasetSourceSelection, ...]

    @property
    def mosaic_required(self) -> bool:
        return len(self.sources) > 1


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
    """Resolve the concrete DTM1 GeoTIFF link from official Atom metadata."""
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


def _crs_spatial_entries(entries: list[Entry], required_crs: str) -> tuple[list[Entry], list[Entry]]:
    resolved: list[Entry] = []
    unresolved: list[Entry] = []
    for entry in entries:
        if required_crs not in category_crs(entry):
            continue
        if entry.declared_extent is None:
            unresolved.append(entry)
        else:
            resolved.append(entry)
    return resolved, unresolved


def select_dataset_sources(
    entries: list[Entry],
    target: tuple[float, float, float, float] = TARGET_EPSG25832,
    required_crs: str = DTM1_SOURCE_CRS,
) -> DatasetSourcePlan:
    """Resolve the smallest unambiguous official source set covering a target.

    A runtime/world tile may cross one or more source-tile boundaries because the
    source and canonical runtime grids use different CRSs. Selection therefore
    operates on actual declared GeoRSS geometry. A single covering source is
    preferred. Otherwise the smallest unique combination of intersecting source
    extents whose geometric union covers the full target is returned. Ambiguous
    minimal source sets fail closed rather than relying on filename or list order.
    """

    target_polygon = target_wgs84_polygon(target)
    resolved, unresolved = _crs_spatial_entries(entries, required_crs)

    singles = [entry for entry in resolved if declared_extent_covers_target(entry.declared_extent, target_polygon)]
    if len(singles) == 1:
        selected = singles[0]
        assert selected.declared_extent is not None
        return DatasetSourcePlan(
            target_wgs84_bounds=tuple(target_polygon.bounds),
            sources=(DatasetSourceSelection(selected, geotiff_href(selected), selected.declared_extent),),
        )
    if len(singles) > 1:
        raise UnresolvedSpatialIndex(f"multiple GeoRSS entries contain target: {len(singles)}")

    intersecting = []
    for entry in resolved:
        extent = entry.declared_extent
        assert extent is not None
        intersection = extent.geometry.intersection(target_polygon)
        if not intersection.is_empty and intersection.area > 0:
            intersecting.append(entry)

    # A 1 km target should only intersect a very small number of 15 km source
    # extents. A large candidate count indicates malformed/overly broad spatial
    # metadata and is safer to reject than to run combinatorial selection.
    if len(intersecting) > 12:
        raise UnresolvedSpatialIndex(
            f"too many intersecting GeoRSS entries for deterministic source-set resolution: {len(intersecting)}"
        )

    for count in range(2, len(intersecting) + 1):
        covering: list[tuple[Entry, ...]] = []
        for candidate_set in combinations(intersecting, count):
            union = unary_union([entry.declared_extent.geometry for entry in candidate_set if entry.declared_extent])
            if union.covers(target_polygon):
                covering.append(candidate_set)
        if not covering:
            continue
        if len(covering) != 1:
            raise UnresolvedSpatialIndex(
                f"multiple minimal GeoRSS source sets cover target: {len(covering)} sets of {count}"
            )
        chosen = tuple(sorted(covering[0], key=lambda item: (geotiff_href(item), item.id)))
        return DatasetSourcePlan(
            target_wgs84_bounds=tuple(target_polygon.bounds),
            sources=tuple(
                DatasetSourceSelection(entry, geotiff_href(entry), entry.declared_extent)
                for entry in chosen
                if entry.declared_extent is not None
            ),
        )

    if unresolved:
        raise UnresolvedSpatialIndex(
            "UNRESOLVED_SPATIAL_INDEX: "
            f"{len(unresolved)} CRS-compatible entries lack official GeoRSS spatial metadata; "
            "filename/id/title inference forbidden"
        )
    raise FeedError("no CRS-compatible dataset source set geometry covers target")


def select_dataset_entry(
    entries: list[Entry],
    target: tuple[float, float, float, float] = TARGET_EPSG25832,
    required_crs: str = DTM1_SOURCE_CRS,
):
    """Backward-compatible single-source selection used by the proven 1 km path."""
    plan = select_dataset_sources(entries, target=target, required_crs=required_crs)
    if plan.mosaic_required:
        raise FeedError(
            f"target requires {len(plan.sources)} DTM1 sources; use multi-source planning/mosaic path"
        )
    selected = plan.sources[0]
    return selected.entry, selected.href, plan.target_wgs84_bounds, selected.extent


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


def source_snapshot_from_digest(
    retrieval: dict,
    raw_sha256: str,
    raw_byte_size: int,
    metadata: dict,
    *,
    expected_source_crs: str = DTM1_SOURCE_CRS,
    expected_vertical_datum: str = DTM1_VERTICAL_DATUM,
) -> dict:
    required = ("crs", "vertical_datum", "pixel_size", "bounds", "nodata")
    missing = [key for key in required if key not in metadata]
    if missing:
        raise FeedError("source validation missing " + ",".join(missing))
    if len(raw_sha256) != 64:
        raise FeedError("invalid raw SHA-256")
    if raw_byte_size <= 0:
        raise FeedError("raw byte size must be positive")
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
        "raw_sha256": raw_sha256,
        "raw_byte_size": raw_byte_size,
        "source_crs": metadata["crs"],
        "source_vertical_datum": metadata["vertical_datum"],
        "z_semantics": "normal_height_m",
        "pixel_size": [canonical_decimal(float(value)) for value in metadata["pixel_size"]],
        "source_bounds": [canonical_decimal(float(value)) for value in metadata["bounds"]],
        "nodata": canonical_decimal(float(metadata["nodata"])) if metadata["nodata"] is not None else None,
        "license_profile": "CC-BY-4.0",
        "promotion_state": "VALIDATED_SOURCE",
    }


def source_snapshot(
    retrieval: dict,
    raw: bytes,
    metadata: dict,
    *,
    expected_source_crs: str = DTM1_SOURCE_CRS,
    expected_vertical_datum: str = DTM1_VERTICAL_DATUM,
) -> dict:
    return source_snapshot_from_digest(
        retrieval,
        sha256(raw),
        len(raw),
        metadata,
        expected_source_crs=expected_source_crs,
        expected_vertical_datum=expected_vertical_datum,
    )


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
