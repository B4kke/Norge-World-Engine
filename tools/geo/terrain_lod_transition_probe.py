#!/usr/bin/env python3
"""Compare bounded mixed-LOD crack-prevention candidates on an NWE height grid.

This probe does not select a runtime strategy. It measures two renderer-facing
candidates:

- edge morph/snap: force the fine outer ring onto the coarser piecewise-linear
  boundary and measure added terrain error plus required vertex displacement;
- skirt cost: project the extra boundary vertices/triangles/buffer bytes needed
  to mask a crack, without choosing skirt depth or claiming authoritative
  geometry.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from terrain_lod_error_probe import (
    build_vertex_heights,
    edge_transition_metrics,
    edge_values,
    error_metrics,
    interpolate_edge,
    mesh_cost,
    read_nwehgt,
    reconstruct_mesh_at_source_centers,
)

SCHEMA = "nwe.terrain-lod-transition-probe/0.1"


def snap_fine_boundary_to_coarse(fine: np.ndarray, coarse: np.ndarray) -> np.ndarray:
    """Return a copy whose fine outer ring follows the coarse linear boundary."""
    snapped = np.array(fine, dtype=np.float64, copy=True)
    coarse_edges = edge_values(coarse)
    snapped[0, :] = interpolate_edge(coarse_edges["north"], snapped.shape[1])
    snapped[-1, :] = interpolate_edge(coarse_edges["south"], snapped.shape[1])
    snapped[:, 0] = interpolate_edge(coarse_edges["west"], snapped.shape[0])
    snapped[:, -1] = interpolate_edge(coarse_edges["east"], snapped.shape[0])
    return snapped


def skirt_cost_projection(output_size: int, width_m: float, height_m: float) -> dict:
    base = mesh_cost(output_size, width_m, height_m)
    base_vertices = base["vertex_count"]
    base_cells = (output_size - 1) * (output_size - 1)
    base_indices = base_cells * 6

    # Duplicate each unique boundary vertex once and connect every boundary
    # segment with one quad (two triangles). Depth is deliberately unspecified.
    added_vertices = 4 * output_size - 4
    boundary_segments = 4 * (output_size - 1)
    added_triangles = boundary_segments * 2
    added_indices = boundary_segments * 6
    total_vertices = base_vertices + added_vertices
    index_bytes = 2 if total_vertices <= 65_535 else 4
    total_indices = base_indices + added_indices
    total_gpu_bytes = total_vertices * 24 + total_indices * index_bytes
    base_gpu_bytes = base["renderer_terrain_gpu_payload_bytes"]
    return {
        "output_size": output_size,
        "added_boundary_vertices": added_vertices,
        "added_triangles": added_triangles,
        "resulting_index_type": "uint16" if index_bytes == 2 else "uint32",
        "renderer_terrain_gpu_payload_bytes_before": base_gpu_bytes,
        "renderer_terrain_gpu_payload_bytes_with_skirt": total_gpu_bytes,
        "renderer_terrain_gpu_payload_delta_bytes": total_gpu_bytes - base_gpu_bytes,
        "renderer_terrain_gpu_payload_delta_fraction": (total_gpu_bytes / base_gpu_bytes) - 1.0,
        "skirt_depth_m": None,
        "interpretation": "Resource-cost projection only. A skirt masks a visual gap with non-authoritative vertical render geometry; no depth, physics use, or world-truth semantics are selected.",
    }


def run_transition_probe(
    artifact: Path,
    coarse_size: int,
    fine_size: int,
    expected_sha256: str | None = None,
) -> dict:
    if coarse_size < 2 or fine_size < 2 or fine_size <= coarse_size:
        raise ValueError("fine_size must be > coarse_size >= 2")
    if (fine_size - 1) % (coarse_size - 1) != 0:
        raise ValueError("this bounded probe requires nested XY grids")

    header, elevations, digest, byte_size = read_nwehgt(artifact, expected_sha256=expected_sha256)
    bounds = tuple(float(value) for value in header["bounds"])
    min_e, min_n, max_e, max_n = bounds
    pixel_size = float(header["pixel_size_m"])
    origin_h = float(header["elevation_min_m"])
    source_height, source_width = elevations.shape

    coarse = build_vertex_heights(
        elevations,
        bounds=bounds,
        pixel_size_m=pixel_size,
        output_size=coarse_size,
        origin_h=origin_h,
    )
    fine = build_vertex_heights(
        elevations,
        bounds=bounds,
        pixel_size_m=pixel_size,
        output_size=fine_size,
        origin_h=origin_h,
    )
    original_transition = edge_transition_metrics(coarse, fine, coarse_size, fine_size)

    snapped = snap_fine_boundary_to_coarse(fine, coarse)
    snapped_transition = edge_transition_metrics(coarse, snapped, coarse_size, fine_size)
    displacement = np.abs(snapped - fine)
    changed = displacement > 1e-12
    changed_values = displacement[changed]

    fine_reconstructed = reconstruct_mesh_at_source_centers(
        fine,
        source_width=source_width,
        source_height=source_height,
    )
    snapped_reconstructed = reconstruct_mesh_at_source_centers(
        snapped,
        source_width=source_width,
        source_height=source_height,
    )
    original_error = error_metrics(fine_reconstructed - elevations)
    snapped_error = error_metrics(snapped_reconstructed - elevations)

    return {
        "schema": SCHEMA,
        "status": "PASS",
        "artifact": {
            "path_basename": artifact.name,
            "sha256": digest,
            "byte_size": byte_size,
            "tile_id": header.get("tile_id"),
            "bounds": list(bounds),
            "source_width": source_width,
            "source_height": source_height,
            "pixel_size_m": pixel_size,
        },
        "transition": {
            "coarse_output_size": coarse_size,
            "fine_output_size": fine_size,
            "nested_xy_grid": True,
            "unmodified_edge": original_transition["potential_unstitched_edge_mismatch"],
        },
        "edge_morph_candidate": {
            "strategy": "snap fine outer-ring heights to coarse piecewise-linear boundary",
            "changed_fine_vertices": int(np.count_nonzero(changed)),
            "fine_vertex_count": fine_size * fine_size,
            "changed_vertex_fraction": float(np.mean(changed)),
            "mean_abs_changed_vertex_displacement_m": float(np.mean(changed_values)) if changed_values.size else 0.0,
            "max_abs_vertex_displacement_m": float(np.max(changed_values)) if changed_values.size else 0.0,
            "fine_surface_error_before": original_error,
            "fine_surface_error_after": snapped_error,
            "rmse_delta_m": snapped_error["rmse_m"] - original_error["rmse_m"],
            "edge_mismatch_after": snapped_transition["potential_unstitched_edge_mismatch"],
            "interpretation": "Geometric candidate only. Zero boundary mismatch does not mean instantaneous snapping is visually acceptable; large vertex displacement can pop and may require temporal geomorphing or index stitching.",
        },
        "skirt_candidate": skirt_cost_projection(fine_size, max_e - min_e, max_n - min_n),
        "decision": {
            "selected_strategy": None,
            "reason": "One low-relief tile is insufficient to choose morphing, index stitching, skirts, constrained neighbor LOD, or another crack-prevention design. Physics/world-truth and render-only masking must remain separate.",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--coarse", type=int, required=True)
    parser.add_argument("--fine", type=int, required=True)
    parser.add_argument("--expected-sha256", default=None)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    result = run_transition_probe(
        args.artifact,
        args.coarse,
        args.fine,
        expected_sha256=args.expected_sha256,
    )
    text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(text, end="")


if __name__ == "__main__":
    main()
