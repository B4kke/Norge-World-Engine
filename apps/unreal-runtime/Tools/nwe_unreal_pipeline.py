#!/usr/bin/env python3
"""Build a deterministic Unreal import/runtime package from verified NWE data.

The normal game never contacts Kartverket, NVDB, or OpenStreetMap. This tool
downloads an immutable, already-compiled NWE snapshot (or consumes a local
copy), verifies its provenance through NWE's canonical verifier, and derives
renderer-only Unreal mesh packets plus a Landscape heightmap.
"""

from __future__ import annotations

import argparse
from array import array
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
from typing import Any, Callable, Sequence
from urllib.request import Request, urlopen


SNAPSHOT_COMMIT = "42f94b63a9172b345d4500473a0aa1aff785fa43"
SNAPSHOT_GENERATOR_COMMIT = "20e0e4451b325e92879cc824149b744c006b1611"
SNAPSHOT_ROOT = "nannestad-preview-1"
SNAPSHOT_BASE_URL = (
    "https://raw.githubusercontent.com/B4kke/Norge-World-Engine/"
    f"{SNAPSHOT_COMMIT}/{SNAPSHOT_ROOT}"
)
EXPECTED_TILE_ID = "epsg25832_611000_6677000_1000m"
EXPECTED_HORIZONTAL_CRS = "EPSG:25832"
EXPECTED_VERTICAL_DATUM = "NN2000"

TERRAIN_MAGIC = b"NWEHGT01"
MESH_MAGIC = b"NWEMSH01"
FIXED_PREFIX_BYTES = 12
MESH_LAYOUT = "positions-f32-normals-f32-uv0-f32-indices-u32-le"

LANDSCAPE_RESOLUTION = 1009
RUNTIME_TERRAIN_RESOLUTION = 505
TERRAIN_CHUNK_QUADS = 126


class PipelineError(RuntimeError):
    """A fail-closed input, provenance, geometry, or output error."""


@dataclass(frozen=True)
class HeightGrid:
    tile_id: str
    horizontal_crs: str
    vertical_datum: str
    bounds: tuple[float, float, float, float]
    width: int
    height: int
    pixel_size_m: float
    elevation_min_m: float
    elevation_max_m: float
    elevations: array


@dataclass(frozen=True)
class MeshPacket:
    material_id: str
    positions_m: tuple[float, ...]
    normals: tuple[float, ...]
    uv0: tuple[float, ...]
    indices: tuple[int, ...]
    truth: dict[str, Any]


def _canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PipelineError(f"cannot read valid JSON from {path}: {exc}") from exc


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise PipelineError(f"cannot hash {path}: {exc}") from exc
    return digest.hexdigest()


def _safe_relative_path(root: Path, raw_path: Any, label: str) -> Path:
    if not isinstance(raw_path, str) or not raw_path:
        raise PipelineError(f"{label} must be a non-empty relative path")
    relative = Path(raw_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise PipelineError(f"{label} escapes its package root")
    resolved_root = root.resolve()
    resolved = (resolved_root / relative).resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise PipelineError(f"{label} escapes its package root")
    return resolved


def _finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PipelineError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise PipelineError(f"{label} must be finite")
    return result


def _positive_integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise PipelineError(f"{label} must be a positive integer")
    return value


def _relative_snapshot_paths(manifest: dict[str, Any]) -> tuple[str, ...]:
    paths = ["manifest.json"]
    for layer in ("terrain", "roads", "buildings"):
        descriptor = manifest.get(layer)
        if not isinstance(descriptor, dict):
            raise PipelineError(f"manifest is missing {layer}")
        for field in ("bundle", "compiled_path"):
            raw = descriptor.get(field)
            if not isinstance(raw, str) or not raw.startswith("./"):
                raise PipelineError(f"manifest {layer}.{field} must be a local relative path")
            relative = raw[2:]
            candidate = Path(relative)
            if candidate.is_absolute() or ".." in candidate.parts:
                raise PipelineError(f"manifest {layer}.{field} escapes the snapshot")
            paths.append(relative)
    return tuple(paths)


def _download(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "NWE-Unreal-Pipeline/0.1"})
    try:
        with urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise PipelineError(f"download failed with HTTP {response.status}: {url}")
            return response.read()
    except PipelineError:
        raise
    except Exception as exc:  # urllib exposes several transport exception types
        raise PipelineError(f"download failed: {url}: {exc}") from exc


def validate_snapshot_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("schema") != "nwe.world-preview-manifest/0.1":
        raise PipelineError("unsupported snapshot manifest schema")
    if manifest.get("status") != "REAL_COMPILED":
        raise PipelineError("snapshot is not REAL_COMPILED")
    if manifest.get("generated_from_commit") != SNAPSHOT_GENERATOR_COMMIT:
        raise PipelineError("snapshot generator commit is not the pinned accepted commit")

    tile = manifest.get("tile")
    if not isinstance(tile, dict):
        raise PipelineError("snapshot tile descriptor is missing")
    if tile.get("id") != EXPECTED_TILE_ID:
        raise PipelineError(f"unexpected tile: {tile.get('id')}")
    if tile.get("horizontal_crs") != EXPECTED_HORIZONTAL_CRS:
        raise PipelineError("snapshot horizontal CRS must be EPSG:25832")
    if tile.get("vertical_datum") != EXPECTED_VERTICAL_DATUM:
        raise PipelineError("snapshot vertical datum must be NN2000")
    bounds = tile.get("bounds")
    if not isinstance(bounds, list) or len(bounds) != 4:
        raise PipelineError("snapshot bounds must be [minE,minN,maxE,maxN]")
    min_e, min_n, max_e, max_n = (
        _finite(value, f"tile.bounds[{index}]") for index, value in enumerate(bounds)
    )
    if not (max_e > min_e and max_n > min_n):
        raise PipelineError("snapshot bounds have no positive extent")
    if abs((max_e - min_e) - 1000.0) > 1e-6 or abs((max_n - min_n) - 1000.0) > 1e-6:
        raise PipelineError("the accepted Unreal vertical slice must be exactly 1000 m square")

    semantics = manifest.get("preview_semantics")
    if not isinstance(semantics, dict) or semantics.get("raw_source_runtime_calls") != 0:
        raise PipelineError("snapshot does not guarantee zero raw-source runtime calls")
    _relative_snapshot_paths(manifest)


def fetch_snapshot(snapshot_dir: Path) -> dict[str, Any]:
    """Download the immutable preview snapshot and retain exact published paths."""

    snapshot_dir = snapshot_dir.resolve()
    manifest_bytes = _download(f"{SNAPSHOT_BASE_URL}/manifest.json")
    try:
        manifest = json.loads(manifest_bytes)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise PipelineError(f"downloaded manifest is invalid: {exc}") from exc
    validate_snapshot_manifest(manifest)

    for relative in _relative_snapshot_paths(manifest):
        data = manifest_bytes if relative == "manifest.json" else _download(
            f"{SNAPSHOT_BASE_URL}/{relative}"
        )
        _write_atomic(snapshot_dir / relative, data)
    return manifest


def verify_snapshot_files(snapshot_dir: Path, manifest: dict[str, Any]) -> None:
    validate_snapshot_manifest(manifest)
    for layer in ("terrain", "roads", "buildings"):
        descriptor = manifest[layer]
        artifact_path = snapshot_dir / descriptor["compiled_path"][2:]
        bundle_path = snapshot_dir / descriptor["bundle"][2:]
        if not artifact_path.is_file() or not bundle_path.is_file():
            raise PipelineError(f"snapshot is missing {layer} artifact or verification bundle")
        actual_size = artifact_path.stat().st_size
        expected_size = _positive_integer(descriptor.get("artifact_byte_size"), f"{layer}.artifact_byte_size")
        if actual_size != expected_size:
            raise PipelineError(f"{layer} artifact size mismatch: {actual_size} != {expected_size}")
        actual_sha = _sha256_file(artifact_path)
        if actual_sha != descriptor.get("artifact_sha256"):
            raise PipelineError(f"{layer} artifact SHA-256 mismatch")


def verify_runtime_provenance(snapshot_dir: Path) -> None:
    script = Path(__file__).with_name("verify_runtime_snapshot.mjs")
    repository_root = Path(__file__).resolve().parents[3]
    try:
        completed = subprocess.run(
            ["node", str(script), str(snapshot_dir.resolve())],
            cwd=repository_root,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        raise PipelineError(f"Node.js is required for canonical NWE provenance verification: {exc}") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise PipelineError(f"runtime provenance rejected the snapshot: {detail}")


def decode_height_grid(data: bytes) -> HeightGrid:
    if len(data) < FIXED_PREFIX_BYTES:
        raise PipelineError("terrain artifact is truncated")
    if data[:8] != TERRAIN_MAGIC:
        raise PipelineError("terrain artifact magic must be NWEHGT01")
    header_length = struct.unpack_from("<I", data, 8)[0]
    if header_length <= 1 or FIXED_PREFIX_BYTES + header_length > len(data):
        raise PipelineError("terrain artifact header length is invalid")
    header_end = FIXED_PREFIX_BYTES + header_length
    try:
        header = json.loads(data[FIXED_PREFIX_BYTES:header_end].decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise PipelineError(f"terrain artifact header is invalid JSON: {exc}") from exc

    if header.get("schema") != "nwe.terrain-height-grid-artifact/0.1":
        raise PipelineError("unsupported terrain artifact schema")
    if header.get("tile_id") != EXPECTED_TILE_ID:
        raise PipelineError("terrain artifact tile does not match the accepted Nannestad tile")
    if header.get("horizontal_crs") != EXPECTED_HORIZONTAL_CRS:
        raise PipelineError("terrain artifact CRS must be EPSG:25832")
    if header.get("vertical_datum") != EXPECTED_VERTICAL_DATUM:
        raise PipelineError("terrain artifact vertical datum must be NN2000")
    if header.get("storage") != "float32-le-row-major-north-to-south":
        raise PipelineError("unsupported terrain artifact storage")

    width = _positive_integer(header.get("width"), "terrain.width")
    height = _positive_integer(header.get("height"), "terrain.height")
    pixel_size_m = _finite(header.get("pixel_size_m"), "terrain.pixel_size_m")
    bounds_raw = header.get("bounds")
    if not isinstance(bounds_raw, list) or len(bounds_raw) != 4:
        raise PipelineError("terrain bounds must be [minE,minN,maxE,maxN]")
    bounds = tuple(
        _finite(value, f"terrain.bounds[{index}]") for index, value in enumerate(bounds_raw)
    )
    if abs((bounds[2] - bounds[0]) - width * pixel_size_m) > 1e-6:
        raise PipelineError("terrain width and bounds disagree")
    if abs((bounds[3] - bounds[1]) - height * pixel_size_m) > 1e-6:
        raise PipelineError("terrain height and bounds disagree")

    expected_payload_size = width * height * 4
    payload = data[header_end:]
    if len(payload) != expected_payload_size:
        raise PipelineError(
            f"terrain payload size mismatch: {len(payload)} != {expected_payload_size}"
        )
    elevations = array("f")
    elevations.frombytes(payload)
    if sys.byteorder != "little":
        elevations.byteswap()
    nodata = header.get("nodata")
    actual_min = math.inf
    actual_max = -math.inf
    for elevation in elevations:
        if not math.isfinite(elevation) or (nodata is not None and elevation == nodata):
            raise PipelineError("terrain contains nodata or non-finite elevations")
        actual_min = min(actual_min, elevation)
        actual_max = max(actual_max, elevation)
    declared_min = _finite(header.get("elevation_min_m"), "terrain.elevation_min_m")
    declared_max = _finite(header.get("elevation_max_m"), "terrain.elevation_max_m")
    if abs(actual_min - declared_min) > 1e-5 or abs(actual_max - declared_max) > 1e-5:
        raise PipelineError("terrain elevation range does not match the artifact header")

    return HeightGrid(
        tile_id=header["tile_id"],
        horizontal_crs=header["horizontal_crs"],
        vertical_datum=header["vertical_datum"],
        bounds=bounds,
        width=width,
        height=height,
        pixel_size_m=pixel_size_m,
        elevation_min_m=actual_min,
        elevation_max_m=actual_max,
        elevations=elevations,
    )


def sample_height(grid: HeightGrid, easting: float, northing: float) -> float:
    """Sample the pixel-centred north-to-south DTM grid with edge clamping."""

    min_e, min_n, max_e, max_n = grid.bounds
    if not (min_e - 1e-6 <= easting <= max_e + 1e-6):
        raise PipelineError(f"easting {easting} lies outside the terrain tile")
    if not (min_n - 1e-6 <= northing <= max_n + 1e-6):
        raise PipelineError(f"northing {northing} lies outside the terrain tile")

    source_x = (easting - min_e) / grid.pixel_size_m - 0.5
    source_y = (max_n - northing) / grid.pixel_size_m - 0.5
    source_x = min(max(source_x, 0.0), grid.width - 1.0)
    source_y = min(max(source_y, 0.0), grid.height - 1.0)
    x0 = int(math.floor(source_x))
    y0 = int(math.floor(source_y))
    x1 = min(x0 + 1, grid.width - 1)
    y1 = min(y0 + 1, grid.height - 1)
    tx = source_x - x0
    ty = source_y - y0

    def at(x: int, y: int) -> float:
        return float(grid.elevations[y * grid.width + x])

    north_row = at(x0, y0) * (1.0 - tx) + at(x1, y0) * tx
    south_row = at(x0, y1) * (1.0 - tx) + at(x1, y1) * tx
    return north_row * (1.0 - ty) + south_row * ty


def resample_height_grid(grid: HeightGrid, resolution: int) -> array:
    resolution = _positive_integer(resolution, "resolution")
    if resolution < 2:
        raise PipelineError("resampled terrain resolution must be at least 2")
    min_e, min_n, max_e, max_n = grid.bounds
    result = array("f")
    for row in range(resolution):
        northing = max_n - (max_n - min_n) * row / (resolution - 1)
        for column in range(resolution):
            easting = min_e + (max_e - min_e) * column / (resolution - 1)
            result.append(sample_height(grid, easting, northing))
    return result


def encode_landscape_r16(
    elevations: Sequence[float], resolution: int
) -> tuple[bytes, dict[str, float]]:
    if len(elevations) != resolution * resolution:
        raise PipelineError("Landscape sample count does not match its resolution")
    minimum = min(elevations)
    maximum = max(elevations)
    if not math.isfinite(minimum) or not math.isfinite(maximum) or maximum <= minimum:
        raise PipelineError("Landscape elevation range must be finite and non-zero")

    span_m = maximum - minimum
    z_scale = span_m * 100.0 * 128.0 / 65535.0
    actor_z_cm = minimum * 100.0 + 256.0 * z_scale
    encoded = array("H")
    for elevation in elevations:
        normalized = (float(elevation) - minimum) / span_m
        encoded.append(max(0, min(65535, int(round(normalized * 65535.0)))))
    if sys.byteorder != "little":
        encoded.byteswap()
    return encoded.tobytes(), {
        "elevation_min_m": float(minimum),
        "elevation_max_m": float(maximum),
        "landscape_z_scale": z_scale,
        "landscape_actor_z_cm": actor_z_cm,
        "max_quantization_error_m": span_m / 65535.0 / 2.0,
    }


def projected_to_unreal_m(
    easting: float,
    northing: float,
    up_m: float,
    *,
    origin_e: float,
    origin_n: float,
    origin_up_m: float,
) -> tuple[float, float, float]:
    """Convert EPSG:25832 ENU to explicit UE left-handed X=east,Y=south,Z=up."""

    result = (
        _finite(easting, "easting") - origin_e,
        -(_finite(northing, "northing") - origin_n),
        _finite(up_m, "up_m") - origin_up_m,
    )
    return tuple(0.0 if value == 0.0 else value for value in result)


def unreal_to_projected_m(
    x_m: float,
    y_m: float,
    z_m: float,
    *,
    origin_e: float,
    origin_n: float,
    origin_up_m: float,
) -> tuple[float, float, float]:
    result = (
        origin_e + _finite(x_m, "x_m"),
        origin_n - _finite(y_m, "y_m"),
        origin_up_m + _finite(z_m, "z_m"),
    )
    return tuple(0.0 if value == 0.0 else value for value in result)


def _normal_from_height_grid(
    heights: Sequence[float], resolution: int, x: int, y: int, spacing_m: float
) -> tuple[float, float, float]:
    left = float(heights[y * resolution + max(0, x - 1)])
    right = float(heights[y * resolution + min(resolution - 1, x + 1)])
    north = float(heights[max(0, y - 1) * resolution + x])
    south = float(heights[min(resolution - 1, y + 1) * resolution + x])
    x_span = spacing_m * (2.0 if 0 < x < resolution - 1 else 1.0)
    y_span = spacing_m * (2.0 if 0 < y < resolution - 1 else 1.0)
    dz_dx = (right - left) / x_span
    dz_dy_south = (south - north) / y_span
    nx, ny, nz = -dz_dx, -dz_dy_south, 1.0
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    return nx / length, ny / length, nz / length


def terrain_mesh_packets(
    grid: HeightGrid,
    *,
    resolution: int = RUNTIME_TERRAIN_RESOLUTION,
    chunk_quads: int = TERRAIN_CHUNK_QUADS,
    origin_e: float,
    origin_n: float,
    origin_up_m: float,
) -> list[tuple[str, MeshPacket]]:
    heights = resample_height_grid(grid, resolution)
    min_e, min_n, max_e, max_n = grid.bounds
    spacing_x = (max_e - min_e) / (resolution - 1)
    spacing_y = (max_n - min_n) / (resolution - 1)
    if abs(spacing_x - spacing_y) > 1e-9:
        raise PipelineError("runtime terrain requires square sampling")
    if (resolution - 1) % chunk_quads != 0:
        raise PipelineError("runtime terrain resolution must divide evenly into chunks")

    packets: list[tuple[str, MeshPacket]] = []
    chunks_per_axis = (resolution - 1) // chunk_quads
    for chunk_y in range(chunks_per_axis):
        for chunk_x in range(chunks_per_axis):
            start_x = chunk_x * chunk_quads
            start_y = chunk_y * chunk_quads
            positions: list[float] = []
            normals: list[float] = []
            uv0: list[float] = []
            indices: list[int] = []

            for local_y in range(chunk_quads + 1):
                source_y = start_y + local_y
                northing = max_n - source_y * spacing_y
                for local_x in range(chunk_quads + 1):
                    source_x = start_x + local_x
                    easting = min_e + source_x * spacing_x
                    elevation = float(heights[source_y * resolution + source_x])
                    position = projected_to_unreal_m(
                        easting,
                        northing,
                        elevation,
                        origin_e=origin_e,
                        origin_n=origin_n,
                        origin_up_m=origin_up_m,
                    )
                    positions.extend(position)
                    normals.extend(
                        _normal_from_height_grid(
                            heights, resolution, source_x, source_y, spacing_x
                        )
                    )
                    uv0.extend((source_x / (resolution - 1), source_y / (resolution - 1)))

            row_width = chunk_quads + 1
            for local_y in range(chunk_quads):
                for local_x in range(chunk_quads):
                    northwest = local_y * row_width + local_x
                    northeast = northwest + 1
                    southwest = northwest + row_width
                    southeast = southwest + 1
                    # Winding is counter-clockwise when viewed from +Z in UE's X/Y plane.
                    indices.extend((northwest, northeast, southwest, northeast, southeast, southwest))

            name = f"terrain_{chunk_y:02d}_{chunk_x:02d}.nwemesh"
            packets.append(
                (
                    name,
                    MeshPacket(
                        material_id="terrain",
                        positions_m=tuple(positions),
                        normals=tuple(normals),
                        uv0=tuple(uv0),
                        indices=tuple(indices),
                        truth={
                            "geometry": "derived-from-verified-dtm1",
                            "source_resolution_m": grid.pixel_size_m,
                            "runtime_resolution_m": spacing_x,
                            "height_datum": EXPECTED_VERTICAL_DATUM,
                        },
                    ),
                )
            )
    return packets


def _validate_vector_artifact(
    artifact: dict[str, Any], *, schema: str, count_field: str, expected_count: int
) -> Sequence[Any]:
    if artifact.get("schema") != schema:
        raise PipelineError(f"unsupported vector artifact schema: {artifact.get('schema')}")
    if artifact.get("tile_id") != EXPECTED_TILE_ID:
        raise PipelineError("vector artifact tile does not match the accepted Nannestad tile")
    if artifact.get("horizontal_crs") != EXPECTED_HORIZONTAL_CRS:
        raise PipelineError("vector artifact CRS must be EPSG:25832")
    features = artifact.get(count_field)
    if not isinstance(features, list) or len(features) != expected_count:
        raise PipelineError(
            f"vector artifact {count_field} count mismatch: "
            f"{len(features) if isinstance(features, list) else 'invalid'} != {expected_count}"
        )
    return features


def _road_width_m(road_type: str) -> float:
    normalized = road_type.casefold()
    if "gang" in normalized or "sykkel" in normalized:
        return 2.5
    if "rampe" in normalized:
        return 3.5
    if "motorveg" in normalized or "motorvei" in normalized:
        return 7.0
    return 3.2


def _planar_direction(
    first: tuple[float, float, float], second: tuple[float, float, float]
) -> tuple[float, float] | None:
    dx, dy = second[0] - first[0], second[1] - first[1]
    length = math.hypot(dx, dy)
    if length <= 1e-6:
        return None
    return dx / length, dy / length


def _road_join_offset(
    points: Sequence[tuple[float, float, float]],
    index: int,
    half_width: float,
    *,
    miter_limit: float = 2.0,
) -> tuple[float, float]:
    if index == 0 or index == len(points) - 1:
        first, second = (
            (points[index], points[1])
            if index == 0
            else (points[index - 1], points[index])
        )
        direction = _planar_direction(first, second)
        if direction is None:
            return half_width, 0.0
        return -direction[1] * half_width, direction[0] * half_width

    incoming = _planar_direction(points[index - 1], points[index])
    outgoing = _planar_direction(points[index], points[index + 1])
    if incoming is None or outgoing is None:
        return half_width, 0.0
    incoming_normal = (-incoming[1], incoming[0])
    outgoing_normal = (-outgoing[1], outgoing[0])
    summed = (
        incoming_normal[0] + outgoing_normal[0],
        incoming_normal[1] + outgoing_normal[1],
    )
    summed_length = math.hypot(*summed)
    if summed_length <= 1e-5:
        return outgoing_normal[0] * half_width, outgoing_normal[1] * half_width
    miter = (summed[0] / summed_length, summed[1] / summed_length)
    denominator = miter[0] * outgoing_normal[0] + miter[1] * outgoing_normal[1]
    if denominator <= 0.2:
        return outgoing_normal[0] * half_width, outgoing_normal[1] * half_width
    length = min(half_width / denominator, half_width * miter_limit)
    return miter[0] * length, miter[1] * length


def road_mesh_packet(
    artifact: dict[str, Any],
    *,
    expected_count: int,
    origin_e: float,
    origin_n: float,
    origin_up_m: float,
) -> MeshPacket:
    paths = _validate_vector_artifact(
        artifact,
        schema="nwe.road-network-artifact/0.1",
        count_field="paths",
        expected_count=expected_count,
    )
    positions: list[float] = []
    normals: list[float] = []
    uv0: list[float] = []
    indices: list[int] = []
    road_lift_m = 0.05
    miter_limit = 2.0
    path_count = 0
    segment_count = 0
    centerline_length_m = 0.0

    for path_index, path in enumerate(paths):
        if not isinstance(path, dict) or not isinstance(path.get("points"), list):
            raise PipelineError(f"road path {path_index} is invalid")
        raw_points = path["points"]
        projected_points: list[tuple[float, float, float]] = []
        for raw_point in raw_points:
            if not isinstance(raw_point, list) or len(raw_point) < 3:
                raise PipelineError(f"road path {path_index} has an invalid point")
            local = projected_to_unreal_m(
                _finite(raw_point[0], "road easting"),
                _finite(raw_point[1], "road northing"),
                _finite(raw_point[2], "road elevation") + road_lift_m,
                origin_e=origin_e,
                origin_n=origin_n,
                origin_up_m=origin_up_m,
            )
            if (
                projected_points
                and math.hypot(
                    local[0] - projected_points[-1][0],
                    local[1] - projected_points[-1][1],
                )
                <= 1e-4
            ):
                continue
            projected_points.append(local)
        if len(projected_points) < 2:
            continue
        half_width = _road_width_m(str(path.get("road_type", "unknown"))) / 2.0
        distance = 0.0
        base = len(positions) // 3
        for point_index, center in enumerate(projected_points):
            if point_index > 0:
                previous = projected_points[point_index - 1]
                distance += math.hypot(center[0] - previous[0], center[1] - previous[1])
            offset_x, offset_y = _road_join_offset(
                projected_points,
                point_index,
                half_width,
                miter_limit=miter_limit,
            )
            positions.extend(
                (
                    center[0] + offset_x, center[1] + offset_y, center[2],
                    center[0] - offset_x, center[1] - offset_y, center[2],
                )
            )
            normals.extend((0.0, 0.0, 1.0) * 2)
            uv0.extend((0.0, distance / 4.0, 1.0, distance / 4.0))
        for segment_index in range(len(projected_points) - 1):
            first = base + segment_index * 2
            indices.extend(
                (first, first + 1, first + 2, first + 1, first + 3, first + 2)
            )
        path_count += 1
        segment_count += len(projected_points) - 1
        centerline_length_m += distance

    return MeshPacket(
        material_id="road_asphalt",
        positions_m=tuple(positions),
        normals=tuple(normals),
        uv0=tuple(uv0),
        indices=tuple(indices),
        truth={
            "centerlines": "verified-nvdb",
            "width": "presentation-fallback-by-road-type",
            "surface_lift_m": road_lift_m,
            "geometry": "connected-strips-with-capped-miter-joins",
            "miter_limit": miter_limit,
            "path_count": path_count,
            "segment_count": segment_count,
            "centerline_length_m": centerline_length_m,
        },
    )


def _signed_area(points: Sequence[tuple[float, float]]) -> float:
    return sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    ) / 2.0


def _cross(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _point_in_triangle(
    point: tuple[float, float],
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    epsilon: float = 1e-9,
) -> bool:
    first = _cross(a, b, point)
    second = _cross(b, c, point)
    third = _cross(c, a, point)
    has_negative = first < -epsilon or second < -epsilon or third < -epsilon
    has_positive = first > epsilon or second > epsilon or third > epsilon
    return not (has_negative and has_positive)


def triangulate_polygon(points: Sequence[tuple[float, float]]) -> tuple[int, ...]:
    """Triangulate a simple polygon using deterministic fail-closed ear clipping."""

    if len(points) < 3:
        raise PipelineError("a building polygon requires at least three unique points")
    area = _signed_area(points)
    if abs(area) <= 1e-9:
        raise PipelineError("building polygon has zero area")
    remaining = list(range(len(points)))
    if area < 0:
        remaining.reverse()
    triangles: list[int] = []
    guard = 0
    while len(remaining) > 3:
        clipped = False
        for cursor, current in enumerate(remaining):
            previous = remaining[(cursor - 1) % len(remaining)]
            following = remaining[(cursor + 1) % len(remaining)]
            a, b, c = points[previous], points[current], points[following]
            if _cross(a, b, c) <= 1e-9:
                continue
            if any(
                _point_in_triangle(points[candidate], a, b, c)
                for candidate in remaining
                if candidate not in (previous, current, following)
            ):
                continue
            triangles.extend((previous, current, following))
            remaining.pop(cursor)
            clipped = True
            break
        guard += 1
        if not clipped or guard > len(points) * len(points):
            raise PipelineError("building polygon could not be triangulated safely")
    triangles.extend(remaining)
    return tuple(triangles)


def _presentation_building_height_m(building_type: str) -> float:
    return {
        "garage": 3.0,
        "garages": 3.0,
        "farm_auxiliary": 4.0,
        "shed": 2.8,
        "house": 6.2,
        "detached": 6.2,
        "terrace": 7.0,
        "farm": 7.0,
        "barn": 7.5,
        "warehouse": 8.0,
        "industrial": 8.0,
        "civic": 9.0,
    }.get(building_type.casefold(), 5.5)


def building_mesh_packets(
    artifact: dict[str, Any],
    terrain: HeightGrid,
    *,
    expected_count: int,
    origin_e: float,
    origin_n: float,
    origin_up_m: float,
) -> list[tuple[str, MeshPacket]]:
    features = _validate_vector_artifact(
        artifact,
        schema="nwe.building-footprint-artifact/0.1",
        count_field="features",
        expected_count=expected_count,
    )
    buckets: dict[str, dict[str, list[Any]]] = {
        "building_walls_source": {"positions": [], "normals": [], "uv0": [], "indices": []},
        "building_roofs_source": {"positions": [], "normals": [], "uv0": [], "indices": []},
        "building_walls_fallback": {"positions": [], "normals": [], "uv0": [], "indices": []},
        "building_roofs_fallback": {"positions": [], "normals": [], "uv0": [], "indices": []},
    }
    source_height_count = 0
    fallback_height_count = 0

    for feature_index, feature in enumerate(features):
        if not isinstance(feature, dict) or not isinstance(feature.get("polygon"), list):
            raise PipelineError(f"building feature {feature_index} is invalid")
        raw_polygon = feature["polygon"]
        projected: list[tuple[float, float]] = []
        for raw_point in raw_polygon:
            if not isinstance(raw_point, list) or len(raw_point) < 2:
                raise PipelineError(f"building feature {feature_index} has an invalid point")
            point = (_finite(raw_point[0], "building easting"), _finite(raw_point[1], "building northing"))
            if not projected or point != projected[-1]:
                projected.append(point)
        if len(projected) > 1 and projected[0] == projected[-1]:
            projected.pop()
        if len(projected) < 3:
            raise PipelineError(f"building feature {feature_index} has fewer than three unique points")

        centroid_e = sum(point[0] for point in projected) / len(projected)
        centroid_n = sum(point[1] for point in projected) / len(projected)
        base_height = sample_height(terrain, centroid_e, centroid_n) + 0.03
        raw_height = feature.get("height_m")
        source_backed = raw_height is not None and feature.get("height_source") != "unresolved"
        if source_backed:
            building_height = _finite(raw_height, "building height")
            source_height_count += 1
            suffix = "source"
        else:
            building_height = _presentation_building_height_m(str(feature.get("building", "unknown")))
            fallback_height_count += 1
            suffix = "fallback"
        if building_height <= 0.0:
            raise PipelineError(f"building feature {feature_index} has a non-positive height")

        local_xy = [
            projected_to_unreal_m(
                easting,
                northing,
                base_height,
                origin_e=origin_e,
                origin_n=origin_n,
                origin_up_m=origin_up_m,
            )
            for easting, northing in projected
        ]
        # EPSG polygon winding is not guaranteed, and the north -> -Y axis
        # conversion flips it. Normalize in UE X/Y space so wall winding,
        # outward normals, and one-sided material rendering always agree.
        if _signed_area([(point[0], point[1]) for point in local_xy]) < 0.0:
            local_xy.reverse()

        wall = buckets[f"building_walls_{suffix}"]
        perimeter_distance = 0.0
        for edge_index, a in enumerate(local_xy):
            b = local_xy[(edge_index + 1) % len(local_xy)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            edge_length = math.hypot(dx, dy)
            if edge_length <= 1e-6:
                continue
            outward_x, outward_y = dy / edge_length, -dx / edge_length
            base = len(wall["positions"]) // 3
            wall["positions"].extend(
                (
                    a[0], a[1], a[2],
                    b[0], b[1], b[2],
                    a[0], a[1], a[2] + building_height,
                    b[0], b[1], b[2] + building_height,
                )
            )
            wall["normals"].extend((outward_x, outward_y, 0.0) * 4)
            wall["uv0"].extend(
                (
                    perimeter_distance / 4.0, 0.0,
                    (perimeter_distance + edge_length) / 4.0, 0.0,
                    perimeter_distance / 4.0, building_height / 3.0,
                    (perimeter_distance + edge_length) / 4.0, building_height / 3.0,
                )
            )
            wall["indices"].extend((base, base + 1, base + 2, base + 1, base + 3, base + 2))
            perimeter_distance += edge_length

        roof = buckets[f"building_roofs_{suffix}"]
        roof_base = len(roof["positions"]) // 3
        for x_m, y_m, z_m in local_xy:
            roof["positions"].extend((x_m, y_m, z_m + building_height))
            roof["normals"].extend((0.0, 0.0, 1.0))
            roof["uv0"].extend((x_m / 4.0, y_m / 4.0))
        roof_points = [(point[0], point[1]) for point in local_xy]
        roof["indices"].extend(roof_base + index for index in triangulate_polygon(roof_points))

    packets: list[tuple[str, MeshPacket]] = []
    truth = {
        "footprints": "verified-openstreetmap",
        "terrain_grounding": "presentation-derived-from-verified-dtm1",
        "source_height_count": source_height_count,
        "fallback_height_count": fallback_height_count,
        "fallback_heights": "presentation-only-by-building-class",
        "roofs": "presentation-only-flat-triangulation",
    }
    for material_id, bucket in buckets.items():
        if not bucket["indices"]:
            continue
        packets.append(
            (
                f"{material_id}.nwemesh",
                MeshPacket(
                    material_id=material_id,
                    positions_m=tuple(bucket["positions"]),
                    normals=tuple(bucket["normals"]),
                    uv0=tuple(bucket["uv0"]),
                    indices=tuple(bucket["indices"]),
                    truth=truth,
                ),
            )
        )
    return packets


def encode_mesh_packet(packet: MeshPacket, *, source_sha256: str) -> bytes:
    vertex_count = len(packet.positions_m) // 3
    if vertex_count <= 0 or len(packet.positions_m) != vertex_count * 3:
        raise PipelineError("mesh packet positions are empty or malformed")
    if len(packet.normals) != vertex_count * 3 or len(packet.uv0) != vertex_count * 2:
        raise PipelineError("mesh packet vertex attributes disagree")
    if not packet.indices or len(packet.indices) % 3 != 0:
        raise PipelineError("mesh packet indices must contain triangles")
    if max(packet.indices) >= vertex_count or min(packet.indices) < 0:
        raise PipelineError("mesh packet index is outside the vertex array")
    for value in (*packet.positions_m, *packet.normals, *packet.uv0):
        if not math.isfinite(value):
            raise PipelineError("mesh packet contains non-finite attributes")

    xs = packet.positions_m[0::3]
    ys = packet.positions_m[1::3]
    zs = packet.positions_m[2::3]
    header = {
        "schema": "nwe.unreal-mesh-packet/0.1",
        "coordinate_frame": "unreal-local-x-east-y-south-z-up-m",
        "layout": MESH_LAYOUT,
        "material_id": packet.material_id,
        "source_sha256": source_sha256,
        "vertex_count": vertex_count,
        "index_count": len(packet.indices),
        "triangle_count": len(packet.indices) // 3,
        "bounds_m": [min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)],
        "truth": packet.truth,
    }
    header_bytes = _canonical_json_bytes(header)
    payload = bytearray()
    payload.extend(struct.pack(f"<{len(packet.positions_m)}f", *packet.positions_m))
    payload.extend(struct.pack(f"<{len(packet.normals)}f", *packet.normals))
    payload.extend(struct.pack(f"<{len(packet.uv0)}f", *packet.uv0))
    payload.extend(struct.pack(f"<{len(packet.indices)}I", *packet.indices))
    return MESH_MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + payload


def _artifact_path(snapshot_dir: Path, descriptor: dict[str, Any]) -> Path:
    return snapshot_dir / str(descriptor["compiled_path"])[2:]


def build_unreal_package(
    snapshot_dir: Path,
    output_dir: Path,
    *,
    provenance_verifier: Callable[[Path], None] = verify_runtime_provenance,
) -> dict[str, Any]:
    snapshot_dir = snapshot_dir.resolve()
    output_dir = output_dir.resolve()
    manifest = _read_json(snapshot_dir / "manifest.json")
    if not isinstance(manifest, dict):
        raise PipelineError("snapshot manifest must be an object")
    verify_snapshot_files(snapshot_dir, manifest)
    provenance_verifier(snapshot_dir)

    tile = manifest["tile"]
    origin_e = _finite(tile["center_e"], "tile.center_e")
    origin_n = _finite(tile["center_n"], "tile.center_n")
    origin_up_m = 0.0

    terrain_path = _artifact_path(snapshot_dir, manifest["terrain"])
    terrain_source_sha = manifest["terrain"]["artifact_sha256"]
    terrain = decode_height_grid(terrain_path.read_bytes())

    landscape_heights = resample_height_grid(terrain, LANDSCAPE_RESOLUTION)
    landscape_bytes, landscape_metadata = encode_landscape_r16(
        landscape_heights, LANDSCAPE_RESOLUTION
    )
    landscape_path = output_dir / "landscape" / "nannestad_1009.r16"
    _write_atomic(landscape_path, landscape_bytes)

    mesh_descriptors: list[dict[str, Any]] = []

    def persist_mesh(relative_name: str, packet: MeshPacket, source_sha: str, collision: bool) -> None:
        mesh_bytes = encode_mesh_packet(packet, source_sha256=source_sha)
        relative_path = Path("meshes") / relative_name
        _write_atomic(output_dir / relative_path, mesh_bytes)
        mesh_descriptors.append(
            {
                "path": relative_path.as_posix(),
                "sha256": _sha256_bytes(mesh_bytes),
                "byte_size": len(mesh_bytes),
                "material_id": packet.material_id,
                "source_sha256": source_sha,
                "collision": collision,
            }
        )

    for name, packet in terrain_mesh_packets(
        terrain,
        origin_e=origin_e,
        origin_n=origin_n,
        origin_up_m=origin_up_m,
    ):
        persist_mesh(name, packet, terrain_source_sha, True)

    roads_path = _artifact_path(snapshot_dir, manifest["roads"])
    roads_artifact = _read_json(roads_path)
    if not isinstance(roads_artifact, dict):
        raise PipelineError("road artifact must be an object")
    roads_packet = road_mesh_packet(
        roads_artifact,
        expected_count=_positive_integer(manifest["roads"]["compiled_count"], "roads.compiled_count"),
        origin_e=origin_e,
        origin_n=origin_n,
        origin_up_m=origin_up_m,
    )
    persist_mesh("roads.nwemesh", roads_packet, manifest["roads"]["artifact_sha256"], False)

    buildings_path = _artifact_path(snapshot_dir, manifest["buildings"])
    buildings_artifact = _read_json(buildings_path)
    if not isinstance(buildings_artifact, dict):
        raise PipelineError("building artifact must be an object")
    for name, packet in building_mesh_packets(
        buildings_artifact,
        terrain,
        expected_count=_positive_integer(
            manifest["buildings"]["compiled_count"], "buildings.compiled_count"
        ),
        origin_e=origin_e,
        origin_n=origin_n,
        origin_up_m=origin_up_m,
    ):
        persist_mesh(name, packet, manifest["buildings"]["artifact_sha256"], True)

    spawn_up_m = sample_height(terrain, origin_e, origin_n) + 2.0
    spawn_unreal_m = projected_to_unreal_m(
        origin_e,
        origin_n,
        spawn_up_m,
        origin_e=origin_e,
        origin_n=origin_n,
        origin_up_m=origin_up_m,
    )
    bounds = tuple(float(value) for value in tile["bounds"])
    landscape_x_scale_cm = (bounds[2] - bounds[0]) * 100.0 / (LANDSCAPE_RESOLUTION - 1)
    landscape_y_scale_cm = (bounds[3] - bounds[1]) * 100.0 / (LANDSCAPE_RESOLUTION - 1)

    package = {
        "schema": "nwe.unreal-world-package/0.1",
        "status": "VERIFIED_DERIVED_RENDER_PACKAGE",
        "target": {
            "engine": "Unreal Engine 5.8",
            "platform": "Windows",
            "experience": "third-person-ground-level-vertical-slice",
        },
        "source": {
            "repository": "B4kke/Norge-World-Engine",
            "snapshot_commit": SNAPSHOT_COMMIT,
            "generator_commit": SNAPSHOT_GENERATOR_COMMIT,
            "preview_id": manifest["preview_id"],
            "artifact_sha256": {
                layer: manifest[layer]["artifact_sha256"]
                for layer in ("terrain", "roads", "buildings")
            },
            "runtime_provenance": "READY_FOR_RUNTIME",
            "raw_source_runtime_calls": 0,
        },
        "georeference": {
            "horizontal_crs": EXPECTED_HORIZONTAL_CRS,
            "vertical_datum": EXPECTED_VERTICAL_DATUM,
            "origin_projected_m": [origin_e, origin_n, origin_up_m],
            "unreal_axes": {"x": "east", "y": "south", "z": "up"},
            "unreal_units_per_metre": 100.0,
            "tile_bounds_projected_m": list(bounds),
        },
        "landscape_import": {
            "path": landscape_path.relative_to(output_dir).as_posix(),
            "sha256": _sha256_bytes(landscape_bytes),
            "resolution": [LANDSCAPE_RESOLUTION, LANDSCAPE_RESOLUTION],
            "row_order": "north-to-south",
            "flip_y": False,
            "actor_location_cm": [-50000.0, -50000.0, landscape_metadata["landscape_actor_z_cm"]],
            "actor_scale": [landscape_x_scale_cm, landscape_y_scale_cm, landscape_metadata["landscape_z_scale"]],
            **landscape_metadata,
            "truth": "quantized-render-derivative-of-verified-dtm1-not-new-world-truth",
        },
        "mesh_packets": mesh_descriptors,
        "spawn": {
            "projected_m": [origin_e, origin_n, spawn_up_m],
            "unreal_cm": [coordinate * 100.0 for coordinate in spawn_unreal_m],
        },
        "truth_boundaries": {
            "terrain": "source-backed DTM1 / EPSG:25832 / NN2000",
            "roads": "source-backed NVDB centerlines; widths remain presentation fallbacks",
            "buildings": "source-backed OSM footprints; unresolved heights and flat roofs remain presentation fallbacks",
            "photorealism": "not claimed until source-backed buildings, production materials, vegetation, and a real UE render pass exist",
        },
        "attribution": manifest["attribution"],
    }
    package_bytes = _canonical_json_bytes(package)
    _write_atomic(output_dir / "world-package.json", package_bytes)
    _write_atomic(
        output_dir / "ATTRIBUTION.txt",
        ("\n".join(manifest["attribution"]) + "\n").encode("utf-8"),
    )
    verify_unreal_package(output_dir)
    return package


def _decode_mesh_packet_header(data: bytes) -> tuple[dict[str, Any], int]:
    if len(data) < FIXED_PREFIX_BYTES or data[:8] != MESH_MAGIC:
        raise PipelineError("derived mesh packet magic must be NWEMSH01")
    header_length = struct.unpack_from("<I", data, 8)[0]
    payload_offset = FIXED_PREFIX_BYTES + header_length
    if header_length <= 1 or payload_offset > len(data):
        raise PipelineError("derived mesh packet header length is invalid")
    try:
        header = json.loads(data[FIXED_PREFIX_BYTES:payload_offset].decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise PipelineError(f"derived mesh packet header is invalid JSON: {exc}") from exc
    if not isinstance(header, dict):
        raise PipelineError("derived mesh packet header must be an object")
    return header, payload_offset


def verify_unreal_package(output_dir: Path) -> dict[str, Any]:
    """Verify every derived file against the generated package before UE sees it."""

    output_dir = output_dir.resolve()
    package = _read_json(output_dir / "world-package.json")
    if not isinstance(package, dict):
        raise PipelineError("derived world package must be an object")
    if package.get("schema") != "nwe.unreal-world-package/0.1":
        raise PipelineError("derived world package schema is unsupported")
    if package.get("status") != "VERIFIED_DERIVED_RENDER_PACKAGE":
        raise PipelineError("derived world package status is not accepted")
    source = package.get("source")
    if (
        not isinstance(source, dict)
        or source.get("runtime_provenance") != "READY_FOR_RUNTIME"
        or source.get("raw_source_runtime_calls") != 0
    ):
        raise PipelineError("derived world package lost its verified offline provenance")

    landscape = package.get("landscape_import")
    if not isinstance(landscape, dict):
        raise PipelineError("derived world package is missing Landscape metadata")
    landscape_path = _safe_relative_path(
        output_dir, landscape.get("path"), "landscape_import.path"
    )
    resolution = landscape.get("resolution")
    if (
        not isinstance(resolution, list)
        or len(resolution) != 2
        or any(isinstance(value, bool) or not isinstance(value, int) or value <= 1 for value in resolution)
    ):
        raise PipelineError("derived Landscape resolution is invalid")
    expected_landscape_size = resolution[0] * resolution[1] * 2
    if not landscape_path.is_file() or landscape_path.stat().st_size != expected_landscape_size:
        raise PipelineError("derived Landscape byte size does not match its resolution")
    if _sha256_file(landscape_path) != landscape.get("sha256"):
        raise PipelineError("derived Landscape SHA-256 mismatch")

    descriptors = package.get("mesh_packets")
    if not isinstance(descriptors, list) or not descriptors:
        raise PipelineError("derived world package contains no mesh packets")
    for index, descriptor in enumerate(descriptors):
        if not isinstance(descriptor, dict):
            raise PipelineError(f"mesh descriptor {index} must be an object")
        mesh_path = _safe_relative_path(
            output_dir, descriptor.get("path"), f"mesh descriptor {index}.path"
        )
        if not mesh_path.is_file():
            raise PipelineError(f"derived mesh packet is missing: {mesh_path}")
        data = mesh_path.read_bytes()
        if len(data) != _positive_integer(
            descriptor.get("byte_size"), f"mesh descriptor {index}.byte_size"
        ):
            raise PipelineError(f"derived mesh packet {index} byte-size mismatch")
        if _sha256_bytes(data) != descriptor.get("sha256"):
            raise PipelineError(f"derived mesh packet {index} SHA-256 mismatch")
        header, payload_offset = _decode_mesh_packet_header(data)
        if (
            header.get("schema") != "nwe.unreal-mesh-packet/0.1"
            or header.get("coordinate_frame")
            != "unreal-local-x-east-y-south-z-up-m"
            or header.get("layout") != MESH_LAYOUT
            or header.get("material_id") != descriptor.get("material_id")
            or header.get("source_sha256") != descriptor.get("source_sha256")
        ):
            raise PipelineError(f"derived mesh packet {index} header contract mismatch")
        vertex_count = _positive_integer(
            header.get("vertex_count"), f"mesh packet {index}.vertex_count"
        )
        index_count = _positive_integer(
            header.get("index_count"), f"mesh packet {index}.index_count"
        )
        expected_payload_size = vertex_count * (3 + 3 + 2) * 4 + index_count * 4
        if index_count % 3 != 0 or len(data) - payload_offset != expected_payload_size:
            raise PipelineError(f"derived mesh packet {index} payload contract mismatch")
    return package


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("fetch", "verify", "build", "all"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument(
            "--snapshot-dir",
            type=Path,
            default=Path(__file__).resolve().parents[1] / "Saved" / "NWE" / "Snapshot",
        )
        if command in ("build", "all"):
            subparser.add_argument(
                "--output-dir",
                type=Path,
                default=Path(__file__).resolve().parents[1]
                / "Content"
                / "Nannestad"
                / "Generated",
            )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command in ("fetch", "all"):
            fetch_snapshot(args.snapshot_dir)
        manifest = _read_json(args.snapshot_dir / "manifest.json")
        if not isinstance(manifest, dict):
            raise PipelineError("snapshot manifest must be an object")
        verify_snapshot_files(args.snapshot_dir, manifest)
        verify_runtime_provenance(args.snapshot_dir)
        package = None
        if args.command in ("build", "all"):
            package = build_unreal_package(
                args.snapshot_dir,
                args.output_dir,
                provenance_verifier=lambda _snapshot: None,
            )
    except PipelineError as exc:
        print(f"NWE_UNREAL_PIPELINE_REJECTED: {exc}", file=sys.stderr)
        return 1

    result = {
        "status": "PASS",
        "command": args.command,
        "snapshot_commit": SNAPSHOT_COMMIT,
        "tile_id": EXPECTED_TILE_ID,
        "provenance": "READY_FOR_RUNTIME",
        "output": str(args.output_dir.resolve()) if hasattr(args, "output_dir") else None,
        "mesh_packets": len(package["mesh_packets"]) if package is not None else None,
    }
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
