from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable
from urllib.request import Request, urlopen

from nwe_compiler.acquisition import transformed_envelope
from nwe_compiler.raster import RasterContractError, RasterMetadata, inspect_raster
from nwe_compiler.sources.dtm1_atom import (
    DTM1_SOURCE_CRS,
    DTM1_VERTICAL_DATUM,
    parse_feed,
    retrieval_identity,
    select_dataset_entry,
    select_service_dataset,
    source_snapshot_from_digest,
)
from nwe_compiler.tiles import NANNESTAD_TILE, TileSpec

SERVICE_URL = "https://nedlasting.geonorge.no/geonorge/ATOM/hoydedata/Hoydedata_ServiceFeed.atom"
USER_AGENT = "NorgeWorldEngine/0.1 terrain-compiler"
SOURCE_KEY = "terrain-dtm1"


class TerrainAcquisitionError(RuntimeError):
    pass


@dataclass(frozen=True)
class AcquiredTerrainSource:
    raw_path: str
    raw_sha256: str
    raw_byte_size: int
    cache_hit: bool
    retrieval_identity: dict
    raster_metadata: dict
    service_feed_sha256: str
    dataset_feed_sha256: str


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _headers(accept: str) -> dict[str, str]:
    return {"User-Agent": USER_AGENT, "Accept": accept}


def _http_get_bytes(url: str, timeout: float) -> bytes:
    request = Request(url, headers=_headers("application/atom+xml, application/xml;q=0.9"))
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise TerrainAcquisitionError(f"source HTTP {response.status}: {url}")
        return response.read()


def _stream_http_file(url: str, destination: Path, timeout: float) -> tuple[str, int]:
    request = Request(url, headers=_headers("application/geotiff, image/tiff;q=0.9, */*;q=0.1"))
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


def _write_exact(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise TerrainAcquisitionError(f"content-addressed metadata collision: {path}")
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


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


def _inspect_dtm1_raster(path: Path) -> RasterMetadata:
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
        raise TerrainAcquisitionError("DTM1 GeoTIFF must declare nodata for deterministic warp")
    return metadata


def _assert_raster_covers_tile(metadata: RasterMetadata, tile: TileSpec) -> None:
    target_33 = transformed_envelope(tile.bounds, tile.horizontal_crs, DTM1_SOURCE_CRS)
    left, bottom, right, top = metadata.bounds
    t_left, t_bottom, t_right, t_top = target_33
    if not (left <= t_left and bottom <= t_bottom and right >= t_right and top >= t_top):
        raise TerrainAcquisitionError(f"selected DTM1 raster does not cover tile {tile.tile_id}")


def _validate_dtm1_raster(path: Path, tile: TileSpec = NANNESTAD_TILE) -> dict:
    metadata = _inspect_dtm1_raster(path)
    _assert_raster_covers_tile(metadata, tile)
    return _metadata_dict(metadata)


def validate_terrain_source_covers_tiles(
    acquired: AcquiredTerrainSource,
    tiles: Iterable[TileSpec],
) -> dict[str, dict]:
    """Re-verify one exact DTM1 source and prove coverage for every requested tile.

    The raw file is stat/hash/raster-inspected once. Coverage predicates then
    reuse that verified metadata for the complete candidate set, avoiding one
    multi-gigabyte file hash per runtime tile while preserving fail-closed byte
    identity and source-extent checks.
    """

    tile_list = tuple(tiles)
    if not tile_list:
        raise TerrainAcquisitionError("at least one terrain tile is required for coverage validation")
    raw_path = Path(acquired.raw_path)
    try:
        if raw_path.stat().st_size != acquired.raw_byte_size:
            raise TerrainAcquisitionError("DTM1 source byte size changed after acquisition")
    except OSError as exc:
        raise TerrainAcquisitionError("DTM1 source file is unavailable") from exc

    metadata = _inspect_dtm1_raster(raw_path)
    if metadata.byte_size != acquired.raw_byte_size:
        raise TerrainAcquisitionError("DTM1 source byte size changed after acquisition")
    if metadata.sha256 != acquired.raw_sha256:
        raise TerrainAcquisitionError("DTM1 source SHA changed after acquisition")
    metadata_dict = _metadata_dict(metadata)
    if metadata_dict != acquired.raster_metadata:
        raise TerrainAcquisitionError("DTM1 source raster metadata changed after acquisition")

    result: dict[str, dict] = {}
    for tile in tile_list:
        if tile.tile_id in result:
            raise TerrainAcquisitionError(f"duplicate terrain tile id: {tile.tile_id}")
        _assert_raster_covers_tile(metadata, tile)
        result[tile.tile_id] = metadata_dict
    return result


def validate_terrain_source_covers_tile(acquired: AcquiredTerrainSource, tile: TileSpec) -> dict:
    return validate_terrain_source_covers_tiles(acquired, (tile,))[tile.tile_id]


def _cache_dir(cache_root: str | Path, tile: TileSpec = NANNESTAD_TILE) -> Path:
    return Path(cache_root) / "raw" / tile.tile_id / SOURCE_KEY


def _load_cached(cache_root: str | Path, tile: TileSpec = NANNESTAD_TILE) -> AcquiredTerrainSource | None:
    cache_dir = _cache_dir(cache_root, tile)
    pointer_path = cache_dir / "latest.json"
    if not pointer_path.exists():
        return None
    try:
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        raw_sha = str(pointer["raw_sha256"])
        raw_path = cache_dir / f"{raw_sha}.tif"
        if not raw_path.exists():
            raise TerrainAcquisitionError("DTM1 cache pointer references missing raw file")
        if pointer.get("tile_id") != tile.tile_id:
            raise TerrainAcquisitionError("DTM1 cache pointer tile identity mismatch")
        metadata = _inspect_dtm1_raster(raw_path)
        if metadata.byte_size != int(pointer["raw_byte_size"]):
            raise TerrainAcquisitionError("DTM1 cached raw byte size mismatch")
        if metadata.sha256 != raw_sha:
            raise TerrainAcquisitionError("DTM1 cached raw SHA mismatch")
        _assert_raster_covers_tile(metadata, tile)
        raster_metadata = _metadata_dict(metadata)
        return AcquiredTerrainSource(
            str(raw_path),
            raw_sha,
            metadata.byte_size,
            True,
            pointer["retrieval_identity"],
            raster_metadata,
            str(pointer["service_feed_sha256"]),
            str(pointer["dataset_feed_sha256"]),
        )
    except (KeyError, OSError, json.JSONDecodeError) as exc:
        raise TerrainAcquisitionError("invalid DTM1 cache pointer") from exc


def acquire_dtm1(
    cache_root: str | Path,
    *,
    refresh: bool = False,
    offline: bool = False,
    timeout: float = 180.0,
    tile: TileSpec = NANNESTAD_TILE,
    feed_fetcher: Callable[[str, float], bytes] | None = None,
    file_fetcher: Callable[[str, Path, float], tuple[str, int]] | None = None,
) -> AcquiredTerrainSource:
    """Acquire the official DTM1 source tile into ignored raw cache.

    Online selection is driven exclusively by official Atom service/dataset
    metadata, EPSG category and GeoRSS geometry. Offline mode uses the persisted
    retrieval identity and content-addressed raw file and performs no source
    request. ``tile`` controls only target selection/coverage and cache pointer
    identity; source identity remains the exact official raw file bytes.
    """
    if not refresh:
        cached = _load_cached(cache_root, tile)
        if cached is not None:
            return cached
    if offline:
        raise TerrainAcquisitionError("offline cache miss for DTM1")

    fetch_bytes = feed_fetcher or _http_get_bytes
    fetch_file = file_fetcher or _stream_http_file
    service_bytes = fetch_bytes(SERVICE_URL, timeout)
    service_sha = _sha256(service_bytes)
    service_entries = parse_feed(service_bytes)
    _, dataset_url = select_service_dataset(service_entries, "DTM1")

    dataset_bytes = fetch_bytes(dataset_url, timeout)
    dataset_sha = _sha256(dataset_bytes)
    dataset_entries = parse_feed(dataset_bytes)
    selected, file_url, _, extent = select_dataset_entry(dataset_entries, target=tile.bounds)
    identity = retrieval_identity(SERVICE_URL, dataset_url, selected, extent)
    identity = {
        **identity,
        "service_feed_sha256": service_sha,
        "dataset_feed_sha256": dataset_sha,
    }

    cache_dir = _cache_dir(cache_root, tile)
    cache_dir.mkdir(parents=True, exist_ok=True)
    _write_exact(cache_dir / "feeds" / f"{service_sha}.atom", service_bytes)
    _write_exact(cache_dir / "feeds" / f"{dataset_sha}.atom", dataset_bytes)

    tmp_raw = cache_dir / "download.tif.tmp"
    if tmp_raw.exists():
        tmp_raw.unlink()
    try:
        raw_sha, raw_size = fetch_file(file_url, tmp_raw, timeout)
        if not tmp_raw.exists() or tmp_raw.stat().st_size != raw_size:
            raise TerrainAcquisitionError("streamed DTM1 byte size mismatch")
        metadata = _inspect_dtm1_raster(tmp_raw)
        if metadata.byte_size != raw_size:
            raise TerrainAcquisitionError("streamed DTM1 byte size mismatch")
        if metadata.sha256 != raw_sha:
            raise TerrainAcquisitionError("streamed DTM1 SHA mismatch")
        _assert_raster_covers_tile(metadata, tile)
        raster_metadata = _metadata_dict(metadata)
        raw_path = cache_dir / f"{raw_sha}.tif"
        if raw_path.exists():
            existing = _inspect_dtm1_raster(raw_path)
            if existing.byte_size != raw_size or existing.sha256 != raw_sha:
                raise TerrainAcquisitionError("content-addressed DTM1 path collision")
            tmp_raw.unlink()
        else:
            os.replace(tmp_raw, raw_path)
    finally:
        if tmp_raw.exists():
            tmp_raw.unlink()

    pointer = {
        "schema": "nwe.dtm1-raw-cache-pointer/0.1",
        "tile_id": tile.tile_id,
        "source_key": SOURCE_KEY,
        "raw_sha256": raw_sha,
        "raw_byte_size": raw_size,
        "retrieval_identity": identity,
        "service_feed_sha256": service_sha,
        "dataset_feed_sha256": dataset_sha,
        "raster_metadata": raster_metadata,
    }
    latest = cache_dir / "latest.json"
    tmp_latest = latest.with_suffix(".tmp")
    tmp_latest.write_text(json.dumps(pointer, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp_latest, latest)

    return AcquiredTerrainSource(
        str(raw_path), raw_sha, raw_size, False, identity, raster_metadata, service_sha, dataset_sha
    )


def terrain_source_snapshot(acquired: AcquiredTerrainSource) -> dict:
    return source_snapshot_from_digest(
        acquired.retrieval_identity,
        acquired.raw_sha256,
        acquired.raw_byte_size,
        acquired.raster_metadata,
    )
