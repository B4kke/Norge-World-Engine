from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.nhm_wcs_acquisition import acquire_nhm_wcs, nhm_wcs_source_snapshot
from nwe_compiler.nhm_wcs_terrain_artifacts import (
    NORMALIZED_MEDIA_TYPE,
    TRANSFORM_OPERATION,
    compile_nhm_wcs_terrain_artifact,
    persist_nhm_wcs_terrain_artifact,
)
from nwe_compiler.tiles import prototype_tile


CAPABILITIES = b"""<?xml version='1.0' encoding='UTF-8'?>
<WCS_Capabilities xmlns='http://www.opengis.net/wcs'>
  <ContentMetadata>
    <CoverageOfferingBrief><name>nhm_dtm_topo_25832</name></CoverageOfferingBrief>
  </ContentMetadata>
</WCS_Capabilities>
"""
DESCRIBE = b"""<?xml version='1.0' encoding='UTF-8'?>
<CoverageDescription xmlns='http://www.opengis.net/wcs'>
  <CoverageOffering><name>nhm_dtm_topo_25832</name></CoverageOffering>
</CoverageDescription>
"""


def _coverage_bytes(tmp_path: Path, tile) -> bytes:
    tmp_path.mkdir(parents=True, exist_ok=True)
    path = tmp_path / "fixture.tif"
    size = int(tile.size_m)
    left, bottom, _, top = tile.bounds
    rows, cols = np.indices((size, size), dtype="float64")
    east = left + cols + 0.5
    north = top - rows - 0.5
    data = (100.0 + east * 0.01 + north * 0.02).astype("float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=size,
        height=size,
        count=1,
        dtype="float32",
        crs="EPSG:25832",
        transform=from_origin(left, top, 1.0, 1.0),
        nodata=-9999.0,
    ) as dataset:
        dataset.write(data, 1)
    return path.read_bytes()


def test_acquire_compile_persist_and_offline_replay_are_deterministic(tmp_path: Path):
    tile = prototype_tile(1000, 2000, 4)
    coverage = _coverage_bytes(tmp_path, tile)
    calls: list[str] = []

    def fetcher(url: str, _timeout: float, _accept: str):
        calls.append(url)
        if "GetCapabilities" in url:
            return "application/xml", CAPABILITIES
        if "DescribeCoverage" in url:
            return "application/xml", DESCRIBE
        if "GetCoverage" in url:
            return "image/tiff", coverage
        raise AssertionError(url)

    cache = tmp_path / "cache"
    cold = acquire_nhm_wcs(cache, tile=tile, refresh=True, fetcher=fetcher)
    assert len(calls) == 3
    assert cold.cache_hit is False
    assert cold.raster_metadata["valid_samples"] == 16

    snapshot = nhm_wcs_source_snapshot(cold)
    assert snapshot["source_id"] == "kartverket:nhm-dtm-25832-wcs"
    assert snapshot["source_crs"] == "EPSG:25832"
    assert snapshot["source_vertical_datum"] == "NN2000"
    assert snapshot["license_profile"] == "CC-BY-4.0"
    assert snapshot["attribution"] == "© Kartverket"

    compiled = compile_nhm_wcs_terrain_artifact(cold, tile=tile)
    persisted = persist_nhm_wcs_terrain_artifact(compiled, cache, tile=tile)
    assert persisted.sample_count == 16
    assert persisted.bundle["transform_contracts"][0]["operation"] == TRANSFORM_OPERATION
    assert persisted.bundle["transform_contracts"][0]["resampling"] == "none"
    assert persisted.bundle["normalized_snapshots"][0]["media_type"] == NORMALIZED_MEDIA_TYPE
    assert persisted.bundle["normalized_snapshots"][0]["sha256"] == persisted.normalized_sha256
    assert persisted.bundle["artifact_ref"]["sha256"] == persisted.artifact_sha256
    assert persisted.bundle["artifact_ref"]["artifact_status"] == "REAL_COMPILED"
    assert Path(persisted.artifact_path).exists()
    assert Path(persisted.bundle_path).exists()
    assert Path(persisted.normalized_path).exists()

    def forbidden_fetcher(_url: str, _timeout: float, _accept: str):
        raise AssertionError("offline replay performed a source request")

    warm = acquire_nhm_wcs(cache, tile=tile, offline=True, fetcher=forbidden_fetcher)
    assert warm.cache_hit is True
    warm_compiled = compile_nhm_wcs_terrain_artifact(warm, tile=tile)
    assert warm.raw_sha256 == cold.raw_sha256
    assert warm_compiled.normalized_sha256 == compiled.normalized_sha256
    assert warm_compiled.artifact_sha256 == compiled.artifact_sha256
    assert warm_compiled.artifact_bytes == compiled.artifact_bytes
    assert warm_compiled.bundle == compiled.bundle


def test_response_encoding_changes_do_not_change_canonical_grid_or_artifact_when_values_are_equal(tmp_path: Path):
    tile = prototype_tile(1000, 2000, 4)
    first_bytes = _coverage_bytes(tmp_path / "first", tile)

    second_dir = tmp_path / "second"
    second_dir.mkdir()
    first_path = tmp_path / "first" / "fixture.tif"
    with rasterio.open(first_path) as source:
        data = source.read(1)
    second_path = second_dir / "fixture.tif"
    with rasterio.open(
        second_path,
        "w",
        driver="GTiff",
        width=4,
        height=4,
        count=1,
        dtype="float32",
        crs="EPSG:25832",
        transform=from_origin(1000.0, 2004.0, 1.0, 1.0),
        nodata=-9999.0,
        compress="deflate",
    ) as dataset:
        dataset.write(data, 1)
    second_bytes = second_path.read_bytes()
    assert first_bytes != second_bytes

    def make_fetcher(coverage: bytes):
        def fetcher(url: str, _timeout: float, _accept: str):
            if "GetCapabilities" in url:
                return "application/xml", CAPABILITIES
            if "DescribeCoverage" in url:
                return "application/xml", DESCRIBE
            return "image/tiff", coverage
        return fetcher

    first = acquire_nhm_wcs(tmp_path / "cache-a", tile=tile, refresh=True, fetcher=make_fetcher(first_bytes))
    second = acquire_nhm_wcs(tmp_path / "cache-b", tile=tile, refresh=True, fetcher=make_fetcher(second_bytes))
    first_compiled = compile_nhm_wcs_terrain_artifact(first, tile=tile)
    second_compiled = compile_nhm_wcs_terrain_artifact(second, tile=tile)

    assert first.raw_sha256 != second.raw_sha256
    assert first_compiled.normalized_sha256 == second_compiled.normalized_sha256
    assert first_compiled.artifact_sha256 == second_compiled.artifact_sha256
    assert first_compiled.bundle["source_snapshot_hashes"] != second_compiled.bundle["source_snapshot_hashes"]
    assert first_compiled.bundle["lineage_hash"] != second_compiled.bundle["lineage_hash"]
