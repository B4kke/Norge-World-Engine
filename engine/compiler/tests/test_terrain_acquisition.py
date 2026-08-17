from __future__ import annotations

import hashlib
import json
import shutil
from math import ceil
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin

from nwe_compiler.terrain_acquisition import (
    SERVICE_URL,
    TerrainAcquisitionError,
    acquire_dtm1,
    terrain_source_snapshot,
    validate_terrain_source_covers_tile,
)
from nwe_compiler.tiles import NANNESTAD_TILE, TileSpec, prototype_tile

DATASET_URL = "https://example.invalid/DTM1.atom"
FILE_URL = "https://example.invalid/33-125-117.tif"

SERVICE = f'''<feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>{DATASET_URL}</id><title>DTM 1 Høydedata</title><link rel="alternate" type="application/atom+xml" href="{DATASET_URL}"/></entry>
</feed>'''.encode()

DATASET = f'''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:georss="http://www.georss.org/georss">
<entry>
<id>https://example.invalid/id/33-125-117.tif</id><title>Høydedata DTM1 33-125-117</title><updated>2024-11-21T16:52:54</updated>
<category term="http://www.opengis.net/def/crs/EPSG/0/25833" label="ETRS89 / UTM zone 33N"/>
<category term="GeoTIFF" label="GeoTIFF"/>
<link rel="section" type="application/geotiff" href="{FILE_URL}"/>
<georss:polygon>60.203707167608755 10.93041842357574 60.203707167608755 11.21727557763492 60.34617671027682 11.21727557763492 60.34617671027682 10.93041842357574 60.203707167608755 10.93041842357574</georss:polygon>
</entry></feed>'''.encode()


def _source_raster(path: Path, tile: TileSpec = NANNESTAD_TILE):
    transformer = Transformer.from_crs(tile.horizontal_crs, "EPSG:25833", always_xy=True)
    left, bottom, right, top = tile.bounds
    points = [transformer.transform(x, y) for x in (left, right) for y in (bottom, top)]
    min_x = min(p[0] for p in points) - 25
    max_x = max(p[0] for p in points) + 25
    min_y = min(p[1] for p in points) - 25
    max_y = max(p[1] for p in points) + 25
    width = ceil(max_x - min_x)
    height = ceil(max_y - min_y)
    yy, xx = np.mgrid[0:height, 0:width]
    data = (190.0 + xx * 0.001 + yy * 0.001).astype("float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=from_origin(min_x, max_y, 1, 1),
        nodata=-9999.0,
    ) as dst:
        dst.write(data, 1)


def _fetchers(fixture: Path, feed_calls: list[str], file_calls: list[str]):
    def feed_fetcher(url, timeout):
        feed_calls.append(url)
        if url == SERVICE_URL:
            return SERVICE
        if url == DATASET_URL:
            return DATASET
        raise AssertionError(url)

    def file_fetcher(url, destination, timeout):
        file_calls.append(url)
        assert url == FILE_URL
        shutil.copyfile(fixture, destination)
        raw = destination.read_bytes()
        return hashlib.sha256(raw).hexdigest(), len(raw)

    return feed_fetcher, file_fetcher


def test_dtm1_cold_then_offline_cache_uses_exact_raw_file(tmp_path: Path):
    fixture = tmp_path / "fixture.tif"
    _source_raster(fixture)
    feed_calls = []
    file_calls = []
    feed_fetcher, file_fetcher = _fetchers(fixture, feed_calls, file_calls)

    cache = tmp_path / "cache"
    cold = acquire_dtm1(cache, refresh=True, feed_fetcher=feed_fetcher, file_fetcher=file_fetcher)
    warm = acquire_dtm1(
        cache,
        offline=True,
        feed_fetcher=lambda *_: (_ for _ in ()).throw(AssertionError("feed network used")),
        file_fetcher=lambda *_: (_ for _ in ()).throw(AssertionError("file network used")),
    )

    assert not cold.cache_hit
    assert warm.cache_hit
    assert feed_calls == [SERVICE_URL, DATASET_URL]
    assert file_calls == [FILE_URL]
    assert cold.raw_sha256 == warm.raw_sha256
    assert cold.raw_byte_size == warm.raw_byte_size
    assert Path(cold.raw_path).read_bytes() == Path(warm.raw_path).read_bytes()
    assert cold.raster_metadata["crs"] == "EPSG:25833"
    assert cold.raster_metadata["vertical_datum"] == "NN2000"
    assert cold.raster_metadata["pixel_size"] == [1.0, 1.0]

    snapshot = terrain_source_snapshot(cold)
    assert snapshot["raw_sha256"] == cold.raw_sha256
    assert snapshot["source_crs"] == "EPSG:25833"
    assert snapshot["source_vertical_datum"] == "NN2000"
    assert snapshot["retrieval_identity"]["dataset_entry_href"] == FILE_URL
    assert snapshot["retrieval_identity"]["service_feed_sha256"] == cold.service_feed_sha256


def test_neighbor_tile_gets_own_cache_pointer_and_selection_target(tmp_path: Path):
    neighbor = prototype_tile(612000, 6677000)
    fixture = tmp_path / "neighbor.tif"
    _source_raster(fixture, neighbor)
    feed_calls: list[str] = []
    file_calls: list[str] = []
    feed_fetcher, file_fetcher = _fetchers(fixture, feed_calls, file_calls)
    cache = tmp_path / "cache"

    cold = acquire_dtm1(
        cache,
        refresh=True,
        tile=neighbor,
        feed_fetcher=feed_fetcher,
        file_fetcher=file_fetcher,
    )
    warm = acquire_dtm1(cache, offline=True, tile=neighbor)

    assert cold.raw_sha256 == warm.raw_sha256
    assert neighbor.tile_id in cold.raw_path
    pointer = json.loads(
        (cache / "raw" / neighbor.tile_id / "terrain-dtm1" / "latest.json").read_text(encoding="utf-8")
    )
    assert pointer["tile_id"] == neighbor.tile_id
    assert feed_calls == [SERVICE_URL, DATASET_URL]
    assert file_calls == [FILE_URL]


def test_reused_source_must_cover_requested_tile_and_keep_exact_bytes(tmp_path: Path):
    fixture = tmp_path / "fixture.tif"
    _source_raster(fixture)
    feed_calls: list[str] = []
    file_calls: list[str] = []
    feed_fetcher, file_fetcher = _fetchers(fixture, feed_calls, file_calls)
    acquired = acquire_dtm1(
        tmp_path / "cache",
        refresh=True,
        feed_fetcher=feed_fetcher,
        file_fetcher=file_fetcher,
    )

    metadata = validate_terrain_source_covers_tile(acquired, NANNESTAD_TILE)
    assert metadata["crs"] == "EPSG:25833"

    far_tile = prototype_tile(620000, 6677000)
    with pytest.raises(TerrainAcquisitionError, match="does not cover tile"):
        validate_terrain_source_covers_tile(acquired, far_tile)

    raw_path = Path(acquired.raw_path)
    with raw_path.open("ab") as fh:
        fh.write(b"tamper")
    with pytest.raises(TerrainAcquisitionError, match="byte size changed"):
        validate_terrain_source_covers_tile(acquired, NANNESTAD_TILE)
