from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable
from urllib.request import Request, urlopen

from pyproj import Transformer
from shapely.geometry import Polygon, box as shapely_box
from shapely.ops import transform as shapely_transform, unary_union

from nwe_compiler.raster import RasterContractError, RasterMetadata, inspect_raster
from nwe_compiler.sources.dtm1_atom import (
    DTM1_SOURCE_CRS,
    DTM1_VERTICAL_DATUM,
    DatasetSourcePlan,
    DatasetSourceSelection,
    Entry,
    parse_feed,
    retrieval_identity,
    select_dataset_sources,
    select_service_dataset,
)
from nwe_compiler.terrain_acquisition import (
    AcquiredTerrainSource,
    SERVICE_URL,
    TerrainAcquisitionError,
    USER_AGENT,
)
from nwe_compiler.tiles import TileSpec

SOURCE_POOL_KEY = "terrain-dtm1"


@dataclass(frozen=True)
class DTM1Catalog:
    service_url: str
    dataset_url: str
    service_bytes: bytes
    dataset_bytes: bytes
    service_sha256: str
    dataset_sha256: str
    entries: tuple[Entry, ...]


@dataclass(frozen=True)
class DTM1TilePlan:
    tile: TileSpec
    source_plan: DatasetSourcePlan


FeedFetcher = Callable[[str, float], bytes]
FileFetcher = Callable[[str, Path, float], tuple[str, int]]


def _sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _default_feed_fetcher(url: str, timeout: float) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/atom+xml, application/xml;q=0.9",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise TerrainAcquisitionError(f"source HTTP {response.status}: {url}")
        return response.read()


def _default_file_fetcher(url: str, destination: Path, timeout: float) -> tuple[str, int]:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/geotiff, image/tiff;q=0.9, */*;q=0.1",
        },
    )
    digest = hashlib.sha256()
    byte_size = 0
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise TerrainAcquisitionError(f"source HTTP {response.status}: {url}")
        with destination.open("wb") as fh:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                byte_size += len(chunk)
                fh.write(chunk)
    if byte_size <= 0:
        raise TerrainAcquisitionError("DTM1 download returned zero bytes")
    return digest.hexdigest(), byte_size


def fetch_dtm1_catalog(
    *,
    timeout: float = 120.0,
    feed_fetcher: FeedFetcher | None = None,
) -> DTM1Catalog:
    fetch = feed_fetcher or _default_feed_fetcher
    service_bytes = fetch(SERVICE_URL, timeout)
    service_sha = _sha_bytes(service_bytes)
    _, dataset_url = select_service_dataset(parse_feed(service_bytes), "DTM1")
    dataset_bytes = fetch(dataset_url, timeout)
    dataset_sha = _sha_bytes(dataset_bytes)
    entries = tuple(parse_feed(dataset_bytes))
    if not entries:
        raise TerrainAcquisitionError("DTM1 dataset feed contains no entries")
    return DTM1Catalog(
        service_url=SERVICE_URL,
        dataset_url=dataset_url,
        service_bytes=service_bytes,
        dataset_bytes=dataset_bytes,
        service_sha256=service_sha,
        dataset_sha256=dataset_sha,
        entries=entries,
    )


def plan_dtm1_tiles(catalog: DTM1Catalog, tiles: Iterable[TileSpec]) -> tuple[DTM1TilePlan, ...]:
    tile_list = tuple(tiles)
    if not tile_list:
        raise TerrainAcquisitionError("at least one tile is required for DTM1 planning")
    if len({tile.tile_id for tile in tile_list}) != len(tile_list):
        raise TerrainAcquisitionError("duplicate tile ids in DTM1 source plan")
    return tuple(
        DTM1TilePlan(tile=tile, source_plan=select_dataset_sources(list(catalog.entries), target=tile.bounds))
        for tile in tile_list
    )


def unique_source_selections(plans: Iterable[DTM1TilePlan]) -> tuple[DatasetSourceSelection, ...]:
    by_href: dict[str, DatasetSourceSelection] = {}
    for plan in plans:
        for source in plan.source_plan.sources:
            existing = by_href.get(source.href)
            if existing is not None and existing.entry.id != source.entry.id:
                raise TerrainAcquisitionError(f"same DTM1 href maps to multiple entry ids: {source.href}")
            by_href[source.href] = source
    return tuple(by_href[href] for href in sorted(by_href))


def _metadata_dict(metadata: RasterMetadata) -> dict:
    return {
        "crs": metadata.crs,
        "vertical_datum": DTM1_VERTICAL_DATUM,
        "pixel_size": list(metadata.pixel_size),
        "bounds": list(metadata.bounds),
        "nodata": metadata.nodata,
        "width": metadata.width,
        "height": metadata.height,
        "count": metadata.count,
        "dtype": metadata.dtype,
    }


def _validate_dtm1_object(path: Path) -> RasterMetadata:
    try:
        metadata = inspect_raster(path)
    except (OSError, RasterContractError) as exc:
        raise TerrainAcquisitionError(f"invalid DTM1 GeoTIFF: {exc}") from exc
    if metadata.crs != DTM1_SOURCE_CRS:
        raise TerrainAcquisitionError(f"expected {DTM1_SOURCE_CRS}, got {metadata.crs}")
    if metadata.count != 1:
        raise TerrainAcquisitionError(f"expected one DTM band, got {metadata.count}")
    if any(abs(value - 1.0) > 1e-6 for value in metadata.pixel_size):
        raise TerrainAcquisitionError(f"expected 1 m DTM1 pixels, got {metadata.pixel_size}")
    if metadata.nodata is None:
        raise TerrainAcquisitionError("DTM1 GeoTIFF must declare nodata")
    return metadata


def _locator_key(href: str) -> str:
    return hashlib.sha256(href.encode("utf-8")).hexdigest()


def _pool_root(cache_root: str | Path) -> Path:
    return Path(cache_root) / "raw" / "source-objects" / SOURCE_POOL_KEY


def _source_dir(cache_root: str | Path, href: str) -> Path:
    return _pool_root(cache_root) / _locator_key(href)


def _write_exact(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise TerrainAcquisitionError(f"content-addressed metadata collision: {path}")
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _current_retrieval(catalog: DTM1Catalog, selection: DatasetSourceSelection) -> dict:
    return {
        **retrieval_identity(catalog.service_url, catalog.dataset_url, selection.entry, selection.extent),
        "service_feed_sha256": catalog.service_sha256,
        "dataset_feed_sha256": catalog.dataset_sha256,
    }


def _load_cached_source(
    cache_root: str | Path,
    catalog: DTM1Catalog,
    selection: DatasetSourceSelection,
) -> AcquiredTerrainSource | None:
    source_dir = _source_dir(cache_root, selection.href)
    pointer_path = source_dir / "latest.json"
    if not pointer_path.exists():
        return None
    try:
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        expected_retrieval = _current_retrieval(catalog, selection)
        if pointer.get("retrieval_identity") != expected_retrieval:
            return None
        raw_sha = str(pointer["raw_sha256"])
        raw_path = source_dir / f"{raw_sha}.tif"
        metadata = _validate_dtm1_object(raw_path)
        if metadata.byte_size != int(pointer["raw_byte_size"]):
            raise TerrainAcquisitionError("DTM1 source-object cached byte size mismatch")
        if metadata.sha256 != raw_sha:
            raise TerrainAcquisitionError("DTM1 source-object cached SHA mismatch")
        return AcquiredTerrainSource(
            raw_path=str(raw_path),
            raw_sha256=raw_sha,
            raw_byte_size=metadata.byte_size,
            cache_hit=True,
            retrieval_identity=expected_retrieval,
            raster_metadata=_metadata_dict(metadata),
            service_feed_sha256=catalog.service_sha256,
            dataset_feed_sha256=catalog.dataset_sha256,
        )
    except (KeyError, OSError, json.JSONDecodeError) as exc:
        raise TerrainAcquisitionError("invalid DTM1 source-object cache pointer") from exc


def acquire_dtm1_source_object(
    cache_root: str | Path,
    catalog: DTM1Catalog,
    selection: DatasetSourceSelection,
    *,
    refresh: bool = False,
    offline: bool = False,
    timeout: float = 600.0,
    file_fetcher: FileFetcher | None = None,
) -> AcquiredTerrainSource:
    if not refresh:
        cached = _load_cached_source(cache_root, catalog, selection)
        if cached is not None:
            return cached
    if offline:
        raise TerrainAcquisitionError(f"offline DTM1 source-object cache miss: {selection.href}")

    source_dir = _source_dir(cache_root, selection.href)
    source_dir.mkdir(parents=True, exist_ok=True)
    feeds_dir = _pool_root(cache_root) / "feeds"
    _write_exact(feeds_dir / f"{catalog.service_sha256}.atom", catalog.service_bytes)
    _write_exact(feeds_dir / f"{catalog.dataset_sha256}.atom", catalog.dataset_bytes)

    fetch_file = file_fetcher or _default_file_fetcher
    tmp = source_dir / "download.tif.tmp"
    if tmp.exists():
        tmp.unlink()
    try:
        raw_sha, raw_size = fetch_file(selection.href, tmp, timeout)
        if not tmp.exists() or tmp.stat().st_size != raw_size:
            raise TerrainAcquisitionError("streamed DTM1 source-object byte size mismatch")
        metadata = _validate_dtm1_object(tmp)
        if metadata.byte_size != raw_size:
            raise TerrainAcquisitionError("streamed DTM1 source-object byte size mismatch")
        if metadata.sha256 != raw_sha:
            raise TerrainAcquisitionError("streamed DTM1 source-object SHA mismatch")
        raw_path = source_dir / f"{raw_sha}.tif"
        if raw_path.exists():
            existing = _validate_dtm1_object(raw_path)
            if existing.byte_size != raw_size or existing.sha256 != raw_sha:
                raise TerrainAcquisitionError("DTM1 source-object content-addressed path collision")
            tmp.unlink()
        else:
            os.replace(tmp, raw_path)
    finally:
        if tmp.exists():
            tmp.unlink()

    retrieval = _current_retrieval(catalog, selection)
    pointer = {
        "schema": "nwe.dtm1-source-object-cache-pointer/0.1",
        "source_key": SOURCE_POOL_KEY,
        "source_locator_sha256": _locator_key(selection.href),
        "raw_sha256": raw_sha,
        "raw_byte_size": raw_size,
        "retrieval_identity": retrieval,
        "raster_metadata": _metadata_dict(metadata),
    }
    pointer_path = source_dir / "latest.json"
    tmp_pointer = pointer_path.with_suffix(".tmp")
    tmp_pointer.write_text(json.dumps(pointer, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp_pointer, pointer_path)

    return AcquiredTerrainSource(
        raw_path=str(raw_path),
        raw_sha256=raw_sha,
        raw_byte_size=raw_size,
        cache_hit=False,
        retrieval_identity=retrieval,
        raster_metadata=_metadata_dict(metadata),
        service_feed_sha256=catalog.service_sha256,
        dataset_feed_sha256=catalog.dataset_sha256,
    )


def acquire_dtm1_source_objects(
    cache_root: str | Path,
    catalog: DTM1Catalog,
    selections: Iterable[DatasetSourceSelection],
    *,
    refresh: bool = False,
    offline: bool = False,
    timeout: float = 600.0,
    file_fetcher: FileFetcher | None = None,
) -> dict[str, AcquiredTerrainSource]:
    unique: dict[str, DatasetSourceSelection] = {}
    for selection in selections:
        existing = unique.get(selection.href)
        if existing is not None and existing.entry.id != selection.entry.id:
            raise TerrainAcquisitionError(f"ambiguous source selection for href: {selection.href}")
        unique[selection.href] = selection
    return {
        href: acquire_dtm1_source_object(
            cache_root,
            catalog,
            unique[href],
            refresh=refresh,
            offline=offline,
            timeout=timeout,
            file_fetcher=file_fetcher,
        )
        for href in sorted(unique)
    }


def revalidate_dtm1_source_objects(
    sources: Iterable[AcquiredTerrainSource],
) -> dict[str, RasterMetadata]:
    result: dict[str, RasterMetadata] = {}
    for source in sources:
        href = str(source.retrieval_identity.get("dataset_entry_href") or "")
        if not href or href in result:
            raise TerrainAcquisitionError("DTM1 source-object set has missing or duplicate href")
        metadata = _validate_dtm1_object(Path(source.raw_path))
        if metadata.sha256 != source.raw_sha256 or metadata.byte_size != source.raw_byte_size:
            raise TerrainAcquisitionError(f"DTM1 source-object byte identity changed: {href}")
        if _metadata_dict(metadata) != source.raster_metadata:
            raise TerrainAcquisitionError(f"DTM1 source-object raster metadata changed: {href}")
        result[href] = metadata
    if not result:
        raise TerrainAcquisitionError("DTM1 source-object set is empty")
    return result


def _target_polygon_in_source_crs(tile: TileSpec) -> Polygon:
    left, bottom, right, top = tile.bounds
    polygon = Polygon(
        [(left, bottom), (right, bottom), (right, top), (left, top), (left, bottom)]
    )
    transformer = Transformer.from_crs(tile.horizontal_crs, DTM1_SOURCE_CRS, always_xy=True)
    return shapely_transform(transformer.transform, polygon)


def validate_dtm1_source_set_covers_tile(
    sources: Iterable[AcquiredTerrainSource],
    tile: TileSpec,
    *,
    revalidated_metadata: dict[str, RasterMetadata] | None = None,
) -> dict:
    source_list = tuple(sources)
    metadata_by_href = revalidated_metadata or revalidate_dtm1_source_objects(source_list)
    source_bounds = []
    source_hashes = []
    for source in source_list:
        href = source.retrieval_identity["dataset_entry_href"]
        metadata = metadata_by_href[href]
        source_bounds.append(shapely_box(*metadata.bounds))
        source_hashes.append(source.raw_sha256)
    target_polygon = _target_polygon_in_source_crs(tile)
    union = unary_union(source_bounds)
    if not union.covers(target_polygon):
        missing_area = target_polygon.difference(union).area
        raise TerrainAcquisitionError(
            f"DTM1 source-object union does not cover tile {tile.tile_id}; missing source-CRS area {missing_area:.6f} m2"
        )
    return {
        "tile_id": tile.tile_id,
        "source_count": len(source_list),
        "source_raw_sha256": sorted(source_hashes),
        "actual_raster_union_covers_target": True,
    }
