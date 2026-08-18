from __future__ import annotations

import hashlib
import math
import shutil
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds
from shapely.geometry import box

from nwe_compiler.dtm1_source_pool import (
    DTM1Catalog,
    acquire_dtm1_source_objects,
    revalidate_dtm1_source_objects,
    validate_dtm1_source_set_covers_tile,
)
from nwe_compiler.sources.dtm1_atom import DatasetSourceSelection, Entry
from nwe_compiler.spatial import DeclaredExtent, target_wgs84_polygon
from nwe_compiler.terrain_acquisition import TerrainAcquisitionError
from nwe_compiler.tiles import NANNESTAD_TILE


def _entry(name: str, href: str, geometry) -> DatasetSourceSelection:
    extent = DeclaredExtent("polygon", geometry, name)
    entry = Entry(
        id=f"https://example.invalid/id/{name}.tif",
        title=name,
        published=None,
        updated="2026-08-18T00:00:00Z",
        links=[
            {
                "rel": "section",
                "href": href,
                "type": "application/geotiff",
                "hreflang": None,
                "title": f"{name}.tif",
            }
        ],
        categories=[
            {
                "term": "http://www.opengis.net/def/crs/EPSG/0/25833",
                "scheme": None,
                "label": "ETRS89 / UTM zone 33N",
            }
        ],
        declared_extent=extent,
    )
    return DatasetSourceSelection(entry, href, extent)


def _catalog(selections: list[DatasetSourceSelection]) -> DTM1Catalog:
    service = b"service-fixture"
    dataset = b"dataset-fixture"
    return DTM1Catalog(
        service_url="https://example.invalid/service.atom",
        dataset_url="https://example.invalid/DTM1.atom",
        service_bytes=service,
        dataset_bytes=dataset,
        service_sha256=hashlib.sha256(service).hexdigest(),
        dataset_sha256=hashlib.sha256(dataset).hexdigest(),
        entries=tuple(selection.entry for selection in selections),
    )


def _write_source(path: Path, bounds: tuple[float, float, float, float], value: float) -> None:
    left, bottom, right, top = bounds
    width = int(right - left)
    height = int(top - bottom)
    assert width > 0 and height > 0
    data = np.full((height, width), value, dtype="float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=from_origin(left, top, 1, 1),
        nodata=-32767.0,
    ) as dst:
        dst.write(data, 1)


def _fixtures(tmp_path: Path):
    source_bounds = transform_bounds(
        "EPSG:25832",
        "EPSG:25833",
        *NANNESTAD_TILE.bounds,
        densify_pts=21,
    )
    left = math.floor(source_bounds[0]) - 5
    bottom = math.floor(source_bounds[1]) - 5
    right = math.ceil(source_bounds[2]) + 5
    top = math.ceil(source_bounds[3]) + 5
    middle = round((left + right) / 2)

    west_path = tmp_path / "west.tif"
    east_path = tmp_path / "east.tif"
    _write_source(west_path, (left, bottom, middle + 5, top), 100.0)
    _write_source(east_path, (middle - 5, bottom, right, top), 100.0)

    target_wgs84 = target_wgs84_polygon(NANNESTAD_TILE.bounds)
    w_left, w_bottom, w_right, w_top = target_wgs84.bounds
    w_mid = (w_left + w_right) / 2
    west = _entry("west", "https://example.invalid/west.tif", box(w_left - 0.01, w_bottom - 0.01, w_mid + 0.001, w_top + 0.01))
    east = _entry("east", "https://example.invalid/east.tif", box(w_mid - 0.001, w_bottom - 0.01, w_right + 0.01, w_top + 0.01))
    return {west.href: west_path, east.href: east_path}, [west, east]


def test_source_pool_downloads_each_unique_source_once_and_reuses_offline(tmp_path: Path):
    fixtures, selections = _fixtures(tmp_path)
    catalog = _catalog(selections)
    calls: list[str] = []

    def fetcher(url, destination, timeout):
        calls.append(url)
        shutil.copyfile(fixtures[url], destination)
        raw = destination.read_bytes()
        return hashlib.sha256(raw).hexdigest(), len(raw)

    cache = tmp_path / "cache"
    cold = acquire_dtm1_source_objects(
        cache,
        catalog,
        [selections[0], selections[1], selections[0]],
        refresh=True,
        file_fetcher=fetcher,
    )
    assert sorted(calls) == sorted(fixtures)
    assert len(cold) == 2
    assert all(not source.cache_hit for source in cold.values())

    warm = acquire_dtm1_source_objects(
        cache,
        catalog,
        selections,
        offline=True,
        file_fetcher=lambda *_: (_ for _ in ()).throw(AssertionError("network used during offline source-pool load")),
    )
    assert set(warm) == set(cold)
    assert all(source.cache_hit for source in warm.values())
    for href in cold:
        assert cold[href].raw_sha256 == warm[href].raw_sha256
        assert cold[href].raw_byte_size == warm[href].raw_byte_size
        assert cold[href].raw_path == warm[href].raw_path


def test_actual_raster_union_must_cover_runtime_tile(tmp_path: Path):
    fixtures, selections = _fixtures(tmp_path)
    catalog = _catalog(selections)

    def fetcher(url, destination, timeout):
        shutil.copyfile(fixtures[url], destination)
        raw = destination.read_bytes()
        return hashlib.sha256(raw).hexdigest(), len(raw)

    sources_by_href = acquire_dtm1_source_objects(
        tmp_path / "cache",
        catalog,
        selections,
        refresh=True,
        file_fetcher=fetcher,
    )
    sources = tuple(sources_by_href.values())
    metadata = revalidate_dtm1_source_objects(sources)
    proof = validate_dtm1_source_set_covers_tile(sources, NANNESTAD_TILE, revalidated_metadata=metadata)
    assert proof["actual_raster_union_covers_target"] is True
    assert proof["source_count"] == 2
    assert len(proof["source_raw_sha256"]) == 2

    west_only = (sources_by_href[selections[0].href],)
    west_metadata = revalidate_dtm1_source_objects(west_only)
    with pytest.raises(TerrainAcquisitionError, match="does not cover tile"):
        validate_dtm1_source_set_covers_tile(west_only, NANNESTAD_TILE, revalidated_metadata=west_metadata)
