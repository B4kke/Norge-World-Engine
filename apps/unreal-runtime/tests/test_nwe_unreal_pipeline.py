from __future__ import annotations

from array import array
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys

import pytest


MODULE_PATH = Path(__file__).parents[1] / "Tools" / "nwe_unreal_pipeline.py"
SPEC = importlib.util.spec_from_file_location("nwe_unreal_pipeline", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
pipeline = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pipeline
SPEC.loader.exec_module(pipeline)


def _terrain_artifact(width: int = 2, height: int = 2) -> bytes:
    elevations = [10.0, 20.0, 30.0, 40.0]
    header = {
        "schema": "nwe.terrain-height-grid-artifact/0.1",
        "tile_id": pipeline.EXPECTED_TILE_ID,
        "horizontal_crs": pipeline.EXPECTED_HORIZONTAL_CRS,
        "vertical_datum": pipeline.EXPECTED_VERTICAL_DATUM,
        "bounds": [611000.0, 6677000.0, 611002.0, 6677002.0],
        "width": width,
        "height": height,
        "pixel_size_m": 1.0,
        "nodata": -9999.0,
        "storage": "float32-le-row-major-north-to-south",
        "elevation_min_m": min(elevations),
        "elevation_max_m": max(elevations),
    }
    header_bytes = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    return (
        pipeline.TERRAIN_MAGIC
        + struct.pack("<I", len(header_bytes))
        + header_bytes
        + struct.pack("<4f", *elevations)
    )


def test_height_grid_decode_and_pixel_centred_sampling() -> None:
    grid = pipeline.decode_height_grid(_terrain_artifact())
    assert grid.width == 2
    assert pipeline.sample_height(grid, 611000.5, 6677001.5) == pytest.approx(10.0)
    assert pipeline.sample_height(grid, 611001.5, 6677000.5) == pytest.approx(40.0)
    assert pipeline.sample_height(grid, 611001.0, 6677001.0) == pytest.approx(25.0)
    assert pipeline.sample_height(grid, 611000.0, 6677002.0) == pytest.approx(10.0)


def test_height_grid_rejects_wrong_magic_and_payload_size() -> None:
    artifact = _terrain_artifact()
    with pytest.raises(pipeline.PipelineError, match="magic"):
        pipeline.decode_height_grid(b"BADMAGIC" + artifact[8:])
    with pytest.raises(pipeline.PipelineError, match="payload size"):
        pipeline.decode_height_grid(artifact[:-1])


def test_unreal_coordinate_contract_is_explicit_and_reversible() -> None:
    local = pipeline.projected_to_unreal_m(
        611625.25,
        6677420.75,
        194.5,
        origin_e=611500.0,
        origin_n=6677500.0,
        origin_up_m=0.0,
    )
    assert local == pytest.approx((125.25, 79.25, 194.5))
    projected = pipeline.unreal_to_projected_m(
        *local,
        origin_e=611500.0,
        origin_n=6677500.0,
        origin_up_m=0.0,
    )
    assert projected == pytest.approx((611625.25, 6677420.75, 194.5))
    origin = pipeline.projected_to_unreal_m(
        611500.0,
        6677500.0,
        0.0,
        origin_e=611500.0,
        origin_n=6677500.0,
        origin_up_m=0.0,
    )
    assert origin == (0.0, 0.0, 0.0)
    assert all(math.copysign(1.0, value) == 1.0 for value in origin)


def test_landscape_encoding_reconstructs_heights_with_declared_error() -> None:
    elevations = array("f", [100.0, 101.25, 102.5, 105.0])
    encoded, metadata = pipeline.encode_landscape_r16(elevations, 2)
    raw = struct.unpack("<4H", encoded)
    reconstructed = [
        metadata["landscape_actor_z_cm"]
        + (value - 32768) * metadata["landscape_z_scale"] / 128.0
        for value in raw
    ]
    for expected_m, actual_cm in zip(elevations, reconstructed, strict=True):
        assert actual_cm / 100.0 == pytest.approx(
            expected_m, abs=metadata["max_quantization_error_m"] + 1e-7
        )
    assert raw[0] == 0
    assert raw[-1] == 65535


def test_concave_polygon_triangulation_preserves_area() -> None:
    polygon = [(0.0, 0.0), (4.0, 0.0), (4.0, 1.0), (1.0, 1.0), (1.0, 4.0), (0.0, 4.0)]
    triangles = pipeline.triangulate_polygon(polygon)
    assert len(triangles) == (len(polygon) - 2) * 3

    area = 0.0
    for index in range(0, len(triangles), 3):
        a, b, c = (polygon[triangles[index + offset]] for offset in range(3))
        area += abs(pipeline._cross(a, b, c)) / 2.0
    assert area == pytest.approx(abs(pipeline._signed_area(polygon)))
    assert area == pytest.approx(7.0)


def test_mesh_packet_encoding_is_deterministic_and_self_describing() -> None:
    packet = pipeline.MeshPacket(
        material_id="terrain",
        positions_m=(0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0),
        normals=(0.0, 0.0, 1.0) * 3,
        uv0=(0.0, 0.0, 1.0, 0.0, 0.0, 1.0),
        indices=(0, 1, 2),
        truth={"geometry": "fixture"},
    )
    first = pipeline.encode_mesh_packet(packet, source_sha256="a" * 64)
    second = pipeline.encode_mesh_packet(packet, source_sha256="a" * 64)
    assert first == second
    assert first.startswith(pipeline.MESH_MAGIC)
    header_length = struct.unpack_from("<I", first, 8)[0]
    header = json.loads(first[12 : 12 + header_length])
    assert header["schema"] == "nwe.unreal-mesh-packet/0.1"
    assert header["coordinate_frame"] == "unreal-local-x-east-y-south-z-up-m"
    assert header["vertex_count"] == 3
    assert header["triangle_count"] == 1


def test_road_paths_form_connected_strips_with_capped_joins() -> None:
    artifact = {
        "schema": "nwe.road-network-artifact/0.1",
        "tile_id": pipeline.EXPECTED_TILE_ID,
        "horizontal_crs": pipeline.EXPECTED_HORIZONTAL_CRS,
        "paths": [
            {
                "road_type": "unknown",
                "points": [
                    [611000.0, 6677000.0, 100.0],
                    [611010.0, 6677000.0, 100.0],
                    [611010.0, 6677010.0, 100.0],
                ],
            }
        ],
    }
    packet = pipeline.road_mesh_packet(
        artifact,
        expected_count=1,
        origin_e=611000.0,
        origin_n=6677000.0,
        origin_up_m=0.0,
    )
    assert len(packet.positions_m) // 3 == 6
    assert packet.indices == (0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4)
    join_left = packet.positions_m[6:9]
    join_right = packet.positions_m[9:12]
    assert math.hypot(join_left[0] - 10.0, join_left[1]) <= 3.2001
    assert math.hypot(join_right[0] - 10.0, join_right[1]) <= 3.2001
    assert packet.truth["path_count"] == 1
    assert packet.truth["segment_count"] == 2
    assert packet.truth["geometry"] == "connected-strips-with-capped-miter-joins"


def test_building_wall_winding_is_outward_for_both_source_orientations() -> None:
    elevations = array("f", [100.0] * 4)
    terrain = pipeline.HeightGrid(
        tile_id=pipeline.EXPECTED_TILE_ID,
        horizontal_crs=pipeline.EXPECTED_HORIZONTAL_CRS,
        vertical_datum=pipeline.EXPECTED_VERTICAL_DATUM,
        bounds=(611000.0, 6677000.0, 611002.0, 6677002.0),
        width=2,
        height=2,
        pixel_size_m=1.0,
        elevation_min_m=100.0,
        elevation_max_m=100.0,
        elevations=elevations,
    )
    clockwise = [
        [611000.25, 6677000.25],
        [611000.25, 6677001.25],
        [611001.25, 6677001.25],
        [611001.25, 6677000.25],
        [611000.25, 6677000.25],
    ]
    for polygon in (clockwise, list(reversed(clockwise))):
        artifact = {
            "schema": "nwe.building-footprint-artifact/0.1",
            "tile_id": pipeline.EXPECTED_TILE_ID,
            "horizontal_crs": pipeline.EXPECTED_HORIZONTAL_CRS,
            "features": [{"polygon": polygon, "building": "house"}],
        }
        packets = pipeline.building_mesh_packets(
            artifact,
            terrain,
            expected_count=1,
            origin_e=611001.0,
            origin_n=6677001.0,
            origin_up_m=0.0,
        )
        wall = next(packet for name, packet in packets if name.startswith("building_walls"))
        a = wall.positions_m[0:3]
        b = wall.positions_m[3:6]
        top = wall.positions_m[6:9]
        edge = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        vertical = (top[0] - a[0], top[1] - a[1], top[2] - a[2])
        geometric_normal = (
            edge[1] * vertical[2] - edge[2] * vertical[1],
            edge[2] * vertical[0] - edge[0] * vertical[2],
            edge[0] * vertical[1] - edge[1] * vertical[0],
        )
        declared_normal = wall.normals[0:3]
        assert sum(a * b for a, b in zip(geometric_normal, declared_normal, strict=True)) > 0.0


def test_derived_package_verifier_rejects_mesh_tampering(tmp_path: Path) -> None:
    packet = pipeline.MeshPacket(
        material_id="terrain",
        positions_m=(0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0),
        normals=(0.0, 0.0, 1.0) * 3,
        uv0=(0.0, 0.0, 1.0, 0.0, 0.0, 1.0),
        indices=(0, 1, 2),
        truth={"geometry": "fixture"},
    )
    source_sha = "a" * 64
    mesh_bytes = pipeline.encode_mesh_packet(packet, source_sha256=source_sha)
    mesh_path = tmp_path / "meshes" / "terrain.nwemesh"
    mesh_path.parent.mkdir(parents=True)
    mesh_path.write_bytes(mesh_bytes)
    landscape_path = tmp_path / "landscape" / "fixture.r16"
    landscape_path.parent.mkdir(parents=True)
    landscape_path.write_bytes(b"\x00\x00" * 4)
    package = {
        "schema": "nwe.unreal-world-package/0.1",
        "status": "VERIFIED_DERIVED_RENDER_PACKAGE",
        "source": {
            "runtime_provenance": "READY_FOR_RUNTIME",
            "raw_source_runtime_calls": 0,
        },
        "landscape_import": {
            "path": "landscape/fixture.r16",
            "sha256": pipeline._sha256_file(landscape_path),
            "resolution": [2, 2],
        },
        "mesh_packets": [
            {
                "path": "meshes/terrain.nwemesh",
                "sha256": pipeline._sha256_bytes(mesh_bytes),
                "byte_size": len(mesh_bytes),
                "material_id": "terrain",
                "source_sha256": source_sha,
                "collision": True,
            }
        ],
    }
    (tmp_path / "world-package.json").write_text(json.dumps(package), encoding="utf-8")
    assert pipeline.verify_unreal_package(tmp_path) == package

    tampered = bytearray(mesh_bytes)
    tampered[-1] ^= 1
    mesh_path.write_bytes(tampered)
    with pytest.raises(pipeline.PipelineError, match="SHA-256 mismatch"):
        pipeline.verify_unreal_package(tmp_path)
