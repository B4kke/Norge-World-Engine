from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from nwe_compiler.terrain_acquisition import AcquiredTerrainSource
from nwe_compiler.terrain_artifacts import (
    MAGIC,
    TerrainArtifactError,
    compile_terrain_artifact,
    persist_terrain_artifact,
)
from nwe_compiler.tiles import NANNESTAD_TILE, TileSpec, prototype_tile


def _acquired(tmp_path: Path) -> AcquiredTerrainSource:
    raw = tmp_path / "raw.tif"
    raw.write_bytes(b"fixture-raw")
    return AcquiredTerrainSource(
        raw_path=str(raw),
        raw_sha256="a" * 64,
        raw_byte_size=raw.stat().st_size,
        cache_hit=True,
        retrieval_identity={
            "service_feed_url": "https://example.invalid/service.atom",
            "dataset_feed_url": "https://example.invalid/DTM1.atom",
            "dataset_entry_id": "https://example.invalid/id.tif",
            "dataset_entry_href": "https://example.invalid/file.tif",
            "dataset_entry_updated": "2024-11-21T16:52:54",
            "dataset_entry_category_crs": ["EPSG:25833"],
            "spatial": {"canonical_spatial_hash": "b" * 64},
        },
        raster_metadata={
            "crs": "EPSG:25833",
            "vertical_datum": "NN2000",
            "pixel_size": [1.0, 1.0],
            "bounds": [275000.0, 6670000.0, 290000.0, 6685000.0],
            "nodata": -9999.0,
            "width": 15000,
            "height": 15000,
            "count": 1,
            "dtype": "float32",
        },
        service_feed_sha256="c" * 64,
        dataset_feed_sha256="d" * 64,
    )


def _normalized(path: Path, tile: TileSpec = NANNESTAD_TILE, *, vertical_datum: str = "NN2000"):
    size = int(tile.size_m)
    yy, xx = np.mgrid[0:size, 0:size]
    data = (180.0 + xx * 0.001 + yy * 0.002).astype("float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=size,
        height=size,
        count=1,
        dtype="float32",
        crs=tile.horizontal_crs,
        transform=from_origin(tile.bounds[0], tile.bounds[3], 1, 1),
        nodata=-9999.0,
        compress="DEFLATE",
        zlevel=6,
        predictor=3,
    ) as dst:
        dst.write(data, 1)
        dst.update_tags(
            NWE_SCHEMA="nwe.normalized-dtm/0.2",
            NWE_VERTICAL_DATUM=vertical_datum,
            NWE_SOURCE_CRS="EPSG:25833",
            NWE_TARGET_CRS=tile.horizontal_crs,
            NWE_TRANSFORM="explicit-reproject-fixed-grid",
            NWE_RESAMPLING="bilinear",
            NWE_PIXEL_SIZE_M="1.0",
        )


def test_terrain_height_grid_artifact_is_deterministic_and_persistable(tmp_path: Path):
    normalized = tmp_path / "normalized.tif"
    _normalized(normalized)
    acquired = _acquired(tmp_path)

    first = compile_terrain_artifact(acquired, normalized)
    second = compile_terrain_artifact(acquired, normalized)
    assert first.artifact_bytes.startswith(MAGIC)
    assert first.artifact_bytes == second.artifact_bytes
    assert first.artifact_sha256 == second.artifact_sha256
    assert first.sample_count == 1_000_000
    assert first.artifact_header["tile_id"] == NANNESTAD_TILE.tile_id
    assert first.artifact_header["horizontal_crs"] == "EPSG:25832"
    assert first.artifact_header["vertical_datum"] == "NN2000"
    assert first.bundle["artifact_ref"]["artifact_status"] == "REAL_COMPILED"
    assert first.bundle["promotion_record"]["gates"]["determinism_policy_satisfied"] == "PASS"

    persisted = persist_terrain_artifact(first, normalized, tmp_path / "cache")
    assert NANNESTAD_TILE.tile_id in persisted.artifact_path
    assert Path(persisted.artifact_path).read_bytes() == first.artifact_bytes
    assert Path(persisted.normalized_path).read_bytes() == normalized.read_bytes()
    assert Path(persisted.bundle_path).exists()


def test_neighbor_tiles_have_distinct_identity_lineage_and_cache_paths(tmp_path: Path):
    acquired = _acquired(tmp_path)
    west = prototype_tile(610000, 6677000)
    east = prototype_tile(612000, 6677000)
    results = []

    for tile in (west, east):
        normalized = tmp_path / f"{tile.tile_id}.tif"
        _normalized(normalized, tile)
        result = compile_terrain_artifact(acquired, normalized, tile=tile)
        persisted = persist_terrain_artifact(result, normalized, tmp_path / "cache")
        results.append(result)

        assert result.artifact_header["tile_id"] == tile.tile_id
        assert result.artifact_header["bounds"] == list(tile.bounds)
        assert result.bundle["compile_lineage"]["tile_id"] == tile.tile_id
        assert result.bundle["artifact_ref"]["tile_id"] == tile.tile_id
        assert result.bundle["transform_contracts"][0]["bounds_epsg25832"] == [
            str(int(value)) for value in tile.bounds
        ]
        assert tile.tile_id in persisted.normalized_path
        assert tile.tile_id in persisted.artifact_path
        assert tile.tile_id in persisted.bundle_path

    assert results[0].bundle["lineage_hash"] != results[1].bundle["lineage_hash"]
    assert results[0].artifact_sha256 != results[1].artifact_sha256


def test_normalized_vertical_datum_must_be_explicit_nn2000(tmp_path: Path):
    normalized = tmp_path / "wrong-datum.tif"
    _normalized(normalized, vertical_datum="UNKNOWN")
    with pytest.raises(TerrainArtifactError, match="NN2000"):
        compile_terrain_artifact(_acquired(tmp_path), normalized)
