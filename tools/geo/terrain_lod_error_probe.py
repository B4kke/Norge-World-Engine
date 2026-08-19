#!/usr/bin/env python3
"""Measure geometric error/cost of NWE terrain mesh resolutions.

This is an evidence tool, not a spatial LOD policy. It evaluates the actual
piecewise-linear triangle surface implied by ``buildTerrainMeshBuffers`` against
all source height-grid pixel centers. Terrain vertex Y is quantized to float32,
matching the renderer-facing position buffer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path
from typing import Iterable

import numpy as np

MAGIC = b"NWEHGT01"
SCHEMA = "nwe.terrain-lod-error-probe/0.1"
DEFAULT_THRESHOLDS_M = (0.1, 0.25, 0.5, 1.0, 2.0)
EDGE_NAMES = ("north", "south", "west", "east")


def _finite_float(value: object, label: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite")
    return number


def read_nwehgt(path: Path, expected_sha256: str | None = None) -> tuple[dict, np.ndarray, str, int]:
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if expected_sha256 and digest != expected_sha256.lower():
        raise ValueError(f"artifact sha256 mismatch: {digest} != {expected_sha256.lower()}")
    if len(data) < 12 or data[:8] != MAGIC:
        raise ValueError("artifact magic must be NWEHGT01")

    header_len = struct.unpack_from("<I", data, 8)[0]
    data_offset = 12 + header_len
    if header_len <= 1 or data_offset > len(data):
        raise ValueError("invalid/truncated NWEHGT01 header")
    try:
        header = json.loads(data[12:data_offset].decode("utf-8"))
    except Exception as exc:  # pragma: no cover - exact exception is input-dependent
        raise ValueError(f"invalid terrain header JSON: {exc}") from exc

    if header.get("schema") != "nwe.terrain-height-grid-artifact/0.1":
        raise ValueError(f"unsupported terrain schema: {header.get('schema')!r}")
    if header.get("storage") != "float32-le-row-major-north-to-south":
        raise ValueError(f"unsupported terrain storage: {header.get('storage')!r}")
    width = int(header.get("width", 0))
    height = int(header.get("height", 0))
    if width <= 0 or height <= 0:
        raise ValueError("terrain width/height must be positive")
    expected_payload = width * height * 4
    if len(data) - data_offset != expected_payload:
        raise ValueError(f"terrain payload bytes {len(data) - data_offset} != {expected_payload}")

    bounds = header.get("bounds")
    if not isinstance(bounds, list) or len(bounds) != 4:
        raise ValueError("terrain bounds must be [minE,minN,maxE,maxN]")
    min_e, min_n, max_e, max_n = (_finite_float(value, f"bounds[{i}]") for i, value in enumerate(bounds))
    if not (max_e > min_e and max_n > min_n):
        raise ValueError("terrain bounds must have positive extent")
    pixel_size = _finite_float(header.get("pixel_size_m"), "pixel_size_m")
    if pixel_size <= 0:
        raise ValueError("pixel_size_m must be > 0")
    if not math.isclose(max_e - min_e, width * pixel_size, abs_tol=1e-6):
        raise ValueError("terrain width/pixel size does not match bounds")
    if not math.isclose(max_n - min_n, height * pixel_size, abs_tol=1e-6):
        raise ValueError("terrain height/pixel size does not match bounds")

    elevations = np.frombuffer(data, dtype="<f4", count=width * height, offset=data_offset).reshape(height, width)
    nodata = _finite_float(header.get("nodata"), "nodata")
    if not np.all(np.isfinite(elevations)) or np.any(elevations == nodata):
        raise ValueError("terrain contains nodata/non-finite elevations")
    return header, elevations.astype(np.float64), digest, len(data)


def sample_height_grid(
    elevations: np.ndarray,
    *,
    bounds: tuple[float, float, float, float],
    pixel_size_m: float,
    eastings: np.ndarray,
    northings: np.ndarray,
) -> np.ndarray:
    """Vectorized equivalent of engine/streaming/sampleHeightGrid pixel-center sampling."""
    height, width = elevations.shape
    min_e, _min_n, _max_e, max_n = bounds
    fx = (np.asarray(eastings, dtype=np.float64) - min_e) / pixel_size_m - 0.5
    fy = (max_n - np.asarray(northings, dtype=np.float64)) / pixel_size_m - 0.5
    fx = np.clip(fx, 0.0, width - 1.0)
    fy = np.clip(fy, 0.0, height - 1.0)

    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    x1 = np.minimum(width - 1, x0 + 1)
    y1 = np.minimum(height - 1, y0 + 1)
    tx = fx - x0
    ty = fy - y0

    q00 = elevations[y0, x0]
    q10 = elevations[y0, x1]
    q01 = elevations[y1, x0]
    q11 = elevations[y1, x1]
    top = q00 * (1.0 - tx) + q10 * tx
    bottom = q01 * (1.0 - tx) + q11 * tx
    return top * (1.0 - ty) + bottom * ty


def build_vertex_heights(
    elevations: np.ndarray,
    *,
    bounds: tuple[float, float, float, float],
    pixel_size_m: float,
    output_size: int,
    origin_h: float,
) -> np.ndarray:
    if output_size < 2:
        raise ValueError("output size must be >= 2")
    min_e, min_n, max_e, max_n = bounds
    columns = np.arange(output_size, dtype=np.float64)
    rows = np.arange(output_size, dtype=np.float64)
    eastings = min_e + columns / (output_size - 1) * (max_e - min_e)
    northings = max_n - rows / (output_size - 1) * (max_n - min_n)
    grid_e, grid_n = np.meshgrid(eastings, northings)
    absolute = sample_height_grid(
        elevations,
        bounds=bounds,
        pixel_size_m=pixel_size_m,
        eastings=grid_e,
        northings=grid_n,
    )
    # buildTerrainMeshBuffers writes elevation-originH into Float32 positions.
    local_y = np.asarray(absolute - origin_h, dtype=np.float32)
    return local_y.astype(np.float64) + origin_h


def reconstruct_mesh_at_source_centers(
    vertex_heights: np.ndarray,
    *,
    source_width: int,
    source_height: int,
) -> np.ndarray:
    """Evaluate the exact triangle topology a,d,b / b,d,e at every source pixel center."""
    output_size = vertex_heights.shape[0]
    if vertex_heights.shape != (output_size, output_size):
        raise ValueError("vertex height grid must be square")

    x = ((np.arange(source_width, dtype=np.float64) + 0.5) / source_width) * (output_size - 1)
    y = ((np.arange(source_height, dtype=np.float64) + 0.5) / source_height) * (output_size - 1)
    grid_x, grid_y = np.meshgrid(x, y)
    ix = np.minimum(np.floor(grid_x).astype(np.int64), output_size - 2)
    iy = np.minimum(np.floor(grid_y).astype(np.int64), output_size - 2)
    tx = grid_x - ix
    ty = grid_y - iy

    a = vertex_heights[iy, ix]
    b = vertex_heights[iy, ix + 1]
    d = vertex_heights[iy + 1, ix]
    e = vertex_heights[iy + 1, ix + 1]

    first = a + (b - a) * tx + (d - a) * ty
    second = b * (1.0 - ty) + d * (1.0 - tx) + e * (tx + ty - 1.0)
    return np.where(tx + ty <= 1.0, first, second)


def percentile(values: np.ndarray, p: float) -> float:
    return float(np.percentile(values, p))


def error_metrics(error: np.ndarray, thresholds_m: Iterable[float] = DEFAULT_THRESHOLDS_M) -> dict:
    absolute = np.abs(error).reshape(-1)
    result = {
        "bias_m": float(np.mean(error)),
        "rmse_m": float(np.sqrt(np.mean(np.square(error)))),
        "mae_m": float(np.mean(absolute)),
        "absolute_error_m": {
            "p50": percentile(absolute, 50),
            "p95": percentile(absolute, 95),
            "p99": percentile(absolute, 99),
            "max": float(np.max(absolute)),
        },
        "fractions_above": {},
    }
    for threshold in thresholds_m:
        result["fractions_above"][f"{threshold:g}_m"] = float(np.mean(absolute > threshold))
    return result


def mesh_cost(output_size: int, width_m: float, height_m: float) -> dict:
    vertex_count = output_size * output_size
    cell_count = (output_size - 1) * (output_size - 1)
    triangle_count = cell_count * 2
    index_count = cell_count * 6
    index_bytes = 2 if vertex_count <= 65_535 else 4
    positions_bytes = vertex_count * 3 * 4
    normals_bytes = positions_bytes
    uvs_bytes = vertex_count * 2 * 4
    indices_bytes = index_count * index_bytes
    return {
        "output_size": output_size,
        "cell_spacing_m": {
            "easting": width_m / (output_size - 1),
            "northing": height_m / (output_size - 1),
        },
        "vertex_count": vertex_count,
        "triangle_count": triangle_count,
        "index_type": "uint16" if index_bytes == 2 else "uint32",
        "worker_mesh_bytes": positions_bytes + normals_bytes + uvs_bytes + indices_bytes,
        "renderer_terrain_gpu_payload_bytes": positions_bytes + normals_bytes + indices_bytes,
        "buffer_bytes": {
            "positions": positions_bytes,
            "normals": normals_bytes,
            "uvs_worker_only": uvs_bytes,
            "indices": indices_bytes,
        },
    }


def edge_values(vertex_heights: np.ndarray) -> dict[str, np.ndarray]:
    return {
        "north": vertex_heights[0, :],
        "south": vertex_heights[-1, :],
        "west": vertex_heights[:, 0],
        "east": vertex_heights[:, -1],
    }


def interpolate_edge(values: np.ndarray, target_count: int) -> np.ndarray:
    source_count = len(values)
    t = np.arange(target_count, dtype=np.float64) / (target_count - 1) * (source_count - 1)
    index = np.minimum(np.floor(t).astype(np.int64), source_count - 2)
    fraction = t - index
    return values[index] * (1.0 - fraction) + values[index + 1] * fraction


def edge_transition_metrics(coarse: np.ndarray, fine: np.ndarray, coarse_size: int, fine_size: int) -> dict:
    nested = (fine_size - 1) % (coarse_size - 1) == 0
    per_edge: dict[str, dict] = {}
    all_differences: list[np.ndarray] = []
    coarse_edges = edge_values(coarse)
    fine_edges = edge_values(fine)
    for name in EDGE_NAMES:
        expected = interpolate_edge(coarse_edges[name], len(fine_edges[name]))
        difference = fine_edges[name] - expected
        all_differences.append(difference)
        metrics = error_metrics(difference, thresholds_m=())
        per_edge[name] = {
            "rmse_m": metrics["rmse_m"],
            "absolute_error_m": metrics["absolute_error_m"],
        }
    combined = np.concatenate(all_differences)
    combined_metrics = error_metrics(combined, thresholds_m=())
    return {
        "coarse_output_size": coarse_size,
        "fine_output_size": fine_size,
        "nested_xy_grid": nested,
        "sample_count": int(combined.size),
        "potential_unstitched_edge_mismatch": {
            "rmse_m": combined_metrics["rmse_m"],
            "absolute_error_m": combined_metrics["absolute_error_m"],
            "per_edge": per_edge,
        },
        "interpretation": "Geometric boundary mismatch if adjacent tiles use these two triangulated resolutions without stitching/skirt/morphing or an equivalent crack-prevention rule; this is not an observed screen-space crack.",
    }


def run_probe(artifact: Path, output_sizes: Iterable[int], expected_sha256: str | None = None) -> dict:
    header, elevations, digest, byte_size = read_nwehgt(artifact, expected_sha256=expected_sha256)
    bounds = tuple(float(value) for value in header["bounds"])
    min_e, min_n, max_e, max_n = bounds
    pixel_size = float(header["pixel_size_m"])
    origin_h = float(header["elevation_min_m"])
    source_height, source_width = elevations.shape
    sizes = sorted(set(int(value) for value in output_sizes))
    if not sizes or sizes[0] < 2:
        raise ValueError("at least one output size >= 2 is required")

    vertex_grids: dict[int, np.ndarray] = {}
    levels: list[dict] = []
    for size in sizes:
        vertices = build_vertex_heights(
            elevations,
            bounds=bounds,
            pixel_size_m=pixel_size,
            output_size=size,
            origin_h=origin_h,
        )
        vertex_grids[size] = vertices
        reconstructed = reconstruct_mesh_at_source_centers(
            vertices,
            source_width=source_width,
            source_height=source_height,
        )
        error = reconstructed - elevations
        levels.append({
            **mesh_cost(size, max_e - min_e, max_n - min_n),
            "geometric_error_against_source_pixel_centers": error_metrics(error),
            "reconstructed_elevation_range_m": [float(np.min(reconstructed)), float(np.max(reconstructed))],
        })

    transitions = [
        edge_transition_metrics(vertex_grids[coarse], vertex_grids[fine], coarse, fine)
        for coarse, fine in zip(sizes, sizes[1:])
    ]

    return {
        "schema": SCHEMA,
        "status": "PASS",
        "artifact": {
            "path_basename": artifact.name,
            "sha256": digest,
            "byte_size": byte_size,
            "tile_id": header.get("tile_id"),
            "horizontal_crs": header.get("horizontal_crs"),
            "vertical_datum": header.get("vertical_datum"),
            "bounds": list(bounds),
            "source_width": source_width,
            "source_height": source_height,
            "pixel_size_m": pixel_size,
            "elevation_min_m": float(header["elevation_min_m"]),
            "elevation_max_m": float(header["elevation_max_m"]),
        },
        "evaluation": {
            "surface": "piecewise-linear triangles matching buildTerrainMeshBuffers topology a,d,b / b,d,e",
            "sample_domain": "all source height-grid pixel centers",
            "sample_count_per_level": source_width * source_height,
            "renderer_height_precision": "float32 local Y + float64 originH reconstruction for measurement",
            "origin_h_m": origin_h,
            "note": "This is a single-tile geometric error/cost envelope. It does not select a distance threshold, screen-space error policy, whole-Norway LOD, crack strategy, or renderer architecture.",
        },
        "levels": levels,
        "adjacent_level_edge_transitions": transitions,
    }


def parse_sizes(text: str) -> list[int]:
    try:
        result = [int(part.strip()) for part in text.split(",") if part.strip()]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("sizes must be comma-separated integers") from exc
    if not result or any(size < 2 for size in result):
        raise argparse.ArgumentTypeError("sizes must contain integers >= 2")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, required=True, help="nwe.terrain-height-grid-artifact/0.1 .nwehgt path")
    parser.add_argument("--sizes", type=parse_sizes, default=[65, 129, 257], help="comma-separated output sizes (default: 65,129,257)")
    parser.add_argument("--expected-sha256", default=None, help="optional exact artifact SHA-256 gate")
    parser.add_argument("--output", type=Path, default=None, help="optional JSON output path")
    args = parser.parse_args()

    result = run_probe(args.artifact, args.sizes, expected_sha256=args.expected_sha256)
    text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(text, end="")


if __name__ == "__main__":
    main()
