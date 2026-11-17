#!/usr/bin/env python3
"""Inspect exact Nannestad LAS/LAZ bytes before any reconstruction claim.

The tool reports source facts rather than deciding that a point cloud is "good
enough" from a project label. It measures byte identity, bounds, point count,
in-tile density, spatial coverage, verified CRS and per-tile LAS classes. laspy/lazrs are loaded lazily so
parser/helper regressions do not require LiDAR dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

SCHEMA = "nwe.nannestad-laz-inspection/0.2"
TILE_ID = "epsg25832_611000_6677000_1000m"
TILE_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)
TILE_AREA_M2 = 1_000_000.0
CLASS_LABELS = {
    0: "created_never_classified",
    1: "unclassified",
    2: "ground",
    3: "low_vegetation",
    4: "medium_vegetation",
    5: "high_vegetation",
    6: "building",
    7: "low_point_noise",
    9: "water",
    17: "bridge_deck",
    18: "high_noise",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def point_in_tile(x: float, y: float) -> bool:
    min_e, min_n, max_e, max_n = TILE_BOUNDS
    return min_e <= x <= max_e and min_n <= y <= max_n


def summarize_classifications(values: Iterable[int]) -> dict[str, Any]:
    counts = Counter(int(value) for value in values)
    by_code = {
        str(code): {
            "label": CLASS_LABELS.get(code, "other_or_provider_specific"),
            "count": count,
        }
        for code, count in sorted(counts.items())
    }
    vegetation = sum(counts.get(code, 0) for code in (3, 4, 5))
    return {
        "by_code": by_code,
        "ground_count": counts.get(2, 0),
        "vegetation_count": vegetation,
        "building_count": counts.get(6, 0),
    }


def summarize_class_counter(counts: Counter[int]) -> dict[str, Any]:
    """Keep large LAZ histogram aggregation O(number_of_classes), not O(points)."""
    by_code = {
        str(code): {"label": CLASS_LABELS.get(code, "other_or_provider_specific"), "count": count}
        for code, count in sorted(counts.items())
    }
    return {
        "by_code": by_code,
        "ground_count": counts.get(2, 0),
        "vegetation_count": sum(counts.get(code, 0) for code in (3, 4, 5)),
        "building_count": counts.get(6, 0),
    }


def crs_components(parsed_crs: Any) -> dict[str, Any]:
    """Never infer NN2000 from a horizontal EPSG code or a Z coordinate."""
    parts = list(parsed_crs.sub_crs_list) if getattr(parsed_crs, "is_compound", False) else (
        [parsed_crs] if parsed_crs is not None else []
    )
    horizontal = next((part for part in parts if getattr(part, "is_projected", False)), None)
    vertical = next((part for part in parts if getattr(part, "is_vertical", False)), None)
    horizontal_epsg = horizontal.to_epsg() if horizontal is not None else None
    vertical_epsg = vertical.to_epsg() if vertical is not None else None
    return {
        "horizontal_epsg": horizontal_epsg,
        "vertical_epsg": vertical_epsg,
        "horizontal_matches_tile": horizontal_epsg == 25832,
        "vertical_matches_tile": vertical_epsg == 5941,
        "truth_guard": "horizontal CRS does not establish a vertical datum; NN2000:2018 EPSG:5941 must be explicit",
    }


def _finite_vector(values: Iterable[Any]) -> list[float]:
    result = [float(value) for value in values]
    if not all(math.isfinite(value) for value in result):
        raise ValueError("non-finite LAS header bound")
    return result


def inspect_laz(path: Path, *, source_project: str | None = None) -> dict[str, Any]:
    try:
        import laspy  # type: ignore
        import numpy as np  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "laspy/lazrs/numpy are required for LAZ inspection; install tools/geo/requirements-lidar.txt"
        ) from exc

    if not path.is_file():
        raise FileNotFoundError(path)

    # Separate global class labels from exact-tile class support; source files
    # may overlap the 1 km tile while containing unrelated nearby forest/roofs.
    global_classes: Counter[int] = Counter()
    tile_classes: Counter[int] = Counter()
    total_points = 0
    in_tile_points = 0
    grid_cells_per_axis = 10
    grid_total = grid_cells_per_axis ** 2
    grid_any = np.zeros(grid_total, dtype=np.int64)
    grid_ground = np.zeros(grid_total, dtype=np.int64)
    grid_vegetation = np.zeros(grid_total, dtype=np.int64)
    grid_buildings = np.zeros(grid_total, dtype=np.int64)
    measured_min = np.array([np.inf, np.inf, np.inf], dtype=np.float64)
    measured_max = np.array([-np.inf, -np.inf, -np.inf], dtype=np.float64)
    min_e, min_n, max_e, max_n = TILE_BOUNDS
    cell_size_m = (max_e - min_e) / grid_cells_per_axis

    with laspy.open(path) as reader:
        header = reader.header
        header_min = _finite_vector(header.mins)
        header_max = _finite_vector(header.maxs)
        parsed_crs = header.parse_crs()
        source_crs = crs_components(parsed_crs)
        crs_text = parsed_crs.to_string() if parsed_crs is not None else None
        point_format_id = int(header.point_format.id)
        las_version = str(header.version)
        header_point_count = int(header.point_count)
        scales = _finite_vector(header.scales)
        offsets = _finite_vector(header.offsets)

        for points in reader.chunk_iterator(1_000_000):
            xs = np.asarray(points.x, dtype=np.float64)
            ys = np.asarray(points.y, dtype=np.float64)
            zs = np.asarray(points.z, dtype=np.float64)
            classes = np.asarray(points.classification, dtype=np.uint8)
            chunk_count = len(points)
            if chunk_count == 0:
                continue
            if not (len(xs) == len(ys) == len(zs) == len(classes) == chunk_count):
                raise RuntimeError("LAS attribute lengths mismatch")
            if not (np.isfinite(xs).all() and np.isfinite(ys).all() and np.isfinite(zs).all()):
                raise RuntimeError("LAS contains non-finite coordinates")

            total_points += chunk_count
            codes, counts = np.unique(classes, return_counts=True)
            for code, count in zip(codes.tolist(), counts.tolist(), strict=True):
                global_classes[int(code)] += int(count)

            chunk_min = np.array([xs.min(), ys.min(), zs.min()], dtype=np.float64)
            chunk_max = np.array([xs.max(), ys.max(), zs.max()], dtype=np.float64)
            measured_min = np.minimum(measured_min, chunk_min)
            measured_max = np.maximum(measured_max, chunk_max)

            inside = (xs >= min_e) & (xs <= max_e) & (ys >= min_n) & (ys <= max_n)
            count_inside = int(np.count_nonzero(inside))
            in_tile_points += count_inside
            if not count_inside:
                continue
            in_classes = classes[inside]
            codes, counts = np.unique(in_classes, return_counts=True)
            for code, count in zip(codes.tolist(), counts.tolist(), strict=True):
                tile_classes[int(code)] += int(count)

            # A point exactly on the tile's maximum boundary belongs to the
            # last cell. 100 m cell hits are coarse spatial evidence, NOT proof
            # of complete source-coverage or regular sampling within a cell.
            ix = np.minimum(grid_cells_per_axis - 1, ((xs[inside] - min_e) / cell_size_m).astype(np.int64))
            iy = np.minimum(grid_cells_per_axis - 1, ((ys[inside] - min_n) / cell_size_m).astype(np.int64))
            cell_index = iy * grid_cells_per_axis + ix
            grid_any += np.bincount(cell_index, minlength=grid_total)
            ground_mask = in_classes == 2
            vegetation_mask = np.isin(in_classes, [3, 4, 5])
            building_mask = in_classes == 6
            grid_ground += np.bincount(cell_index[ground_mask], minlength=grid_total)
            grid_vegetation += np.bincount(cell_index[vegetation_mask], minlength=grid_total)
            grid_buildings += np.bincount(cell_index[building_mask], minlength=grid_total)

    if total_points != header_point_count:
        raise RuntimeError(f"LAS header point_count {header_point_count} != decoded {total_points}")
    if total_points <= 0:
        raise RuntimeError("LAS/LAZ contains no decoded points")

    bounds_match = all(
        abs(float(actual) - float(declared)) <= max(abs(float(scale)) * 1.01, 0.001)
        for actual, declared, scale in zip(
            [*measured_min.tolist(), *measured_max.tolist()],
            [*header_min, *header_max],
            [*scales, *scales],
            strict=True,
        )
    )
    classes = summarize_class_counter(tile_classes)
    ground_cells = int(np.count_nonzero(grid_ground))
    blockers = []
    if not source_crs["horizontal_matches_tile"]:
        blockers.append("HORIZONTAL_CRS_NOT_EPSG_25832")
    if not source_crs["vertical_matches_tile"]:
        blockers.append("VERTICAL_CRS_NN2000_5941_NOT_PROVEN")
    if not bounds_match:
        blockers.append("LAS_HEADER_BOUNDS_DIFFER_FROM_DECODED")
    if in_tile_points == 0:
        blockers.append("NO_POINTS_INSIDE_EXACT_TILE")
    if ground_cells < grid_total:
        blockers.append("GROUND_MISSING_IN_100M_GRID_CELLS")
    if classes["ground_count"] == 0:
        blockers.append("NO_GROUND_CLASS_INSIDE_TILE")

    return {
        "schema": SCHEMA,
        "status": "SOURCE_BYTES_INSPECTED",
        "tile": {
            "id": TILE_ID,
            "horizontal_crs_expected": "EPSG:25832",
            "vertical_datum_expected": "NN2000:2018 / EPSG:5941",
            "bounds": list(TILE_BOUNDS),
            "area_m2": TILE_AREA_M2,
        },
        "source": {
            "path_basename": path.name,
            "byte_size": path.stat().st_size,
            "sha256": sha256_file(path),
            "project": source_project,
        },
        "las": {
            "version": las_version,
            "point_format_id": point_format_id,
            "header_point_count": header_point_count,
            "header_bounds": {"min": header_min, "max": header_max},
            "measured_bounds": {"min": measured_min.tolist(), "max": measured_max.tolist()},
            "header_bounds_match_decoded": bounds_match,
            "scales": scales,
            "offsets": offsets,
            "parsed_crs": crs_text,
            "crs_check": source_crs,
            "global_classification": summarize_class_counter(global_classes),
        },
        "tile_measurement": {
            "points_inside_or_on_tile": in_tile_points,
            "points_outside_tile": total_points - in_tile_points,
            "point_density_per_m2": in_tile_points / TILE_AREA_M2,
            "classification": classes,
            "has_reconstruction_classes": {
                "ground": classes["ground_count"] > 0,
                "vegetation": classes["vegetation_count"] > 0,
                "building": classes["building_count"] > 0,
            },
            "grid_100m": {
                "axis_cells": grid_cells_per_axis,
                "total_cells": grid_total,
                "cells_with_any_points": int(np.count_nonzero(grid_any)),
                "cells_with_ground_class": ground_cells,
                "cells_with_vegetation_class": int(np.count_nonzero(grid_vegetation)),
                "cells_with_building_class": int(np.count_nonzero(grid_buildings)),
                "ground_points_by_cell": grid_ground.tolist(),
                "semantics": "coarse presence test only; occupied cells do not prove complete tile coverage",
            },
        },
        "reconstruction_gate": {
            "status": "SOURCE_CANDIDATE_ONLY" if not blockers else "BLOCKED",
            "blockers": blockers,
            "layer_class_support_in_tile": {
                "ground": classes["ground_count"] > 0,
                "vegetation": classes["vegetation_count"] > 0,
                "building": classes["building_count"] > 0,
            },
            "truth_guard": "SOURCE_CANDIDATE_ONLY never authorizes roof/forest/terrain reconstruction without per-layer quality and coverage validation",
        },
        "truth": (
            "inspection reports exact decoded facts only; source class presence and 100m grid occupancy are "
            "not proof of surveyed roof quality, individual trees or complete tile coverage"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--source-project")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    result = inspect_laz(args.path, source_project=args.source_project)
    if args.expected_sha256 and result["source"]["sha256"].lower() != args.expected_sha256.lower():
        raise SystemExit(
            f"NWE_NANNESTAD_LAZ_SHA256_MISMATCH: {result['source']['sha256']} != {args.expected_sha256}"
        )

    encoded = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
