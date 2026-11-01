#!/usr/bin/env python3
"""Inspect exact Nannestad LAS/LAZ bytes before any reconstruction claim.

The tool intentionally reports source facts rather than deciding that a point
cloud is "good enough" from a project label. It measures byte identity, bounds,
point count, in-tile density and LAS classification counts. laspy/lazrs are
loaded lazily so parser/helper regressions do not require LiDAR dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

SCHEMA = "nwe.nannestad-laz-inspection/0.1"
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


def _finite_vector(values: Iterable[Any]) -> list[float]:
    result = [float(value) for value in values]
    if not all(math.isfinite(value) for value in result):
        raise ValueError("non-finite LAS header bound")
    return result


def inspect_laz(path: Path, *, source_project: str | None = None) -> dict[str, Any]:
    try:
        import laspy  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "laspy/lazrs are required for LAZ inspection; install tools/geo/requirements-lidar.txt"
        ) from exc

    if not path.is_file():
        raise FileNotFoundError(path)

    class_counts: Counter[int] = Counter()
    total_points = 0
    in_tile_points = 0
    measured_min = [math.inf, math.inf, math.inf]
    measured_max = [-math.inf, -math.inf, -math.inf]

    with laspy.open(path) as reader:
        header = reader.header
        header_min = _finite_vector(header.mins)
        header_max = _finite_vector(header.maxs)
        parsed_crs = header.parse_crs()
        crs_text = parsed_crs.to_string() if parsed_crs is not None else None
        point_format_id = int(header.point_format.id)
        las_version = str(header.version)
        header_point_count = int(header.point_count)
        scales = _finite_vector(header.scales)
        offsets = _finite_vector(header.offsets)

        for points in reader.chunk_iterator(1_000_000):
            xs = points.x
            ys = points.y
            zs = points.z
            classes = points.classification
            chunk_count = len(points)
            total_points += chunk_count
            class_counts.update(int(value) for value in classes)
            for index in range(chunk_count):
                x = float(xs[index])
                y = float(ys[index])
                z = float(zs[index])
                measured_min[0] = min(measured_min[0], x)
                measured_min[1] = min(measured_min[1], y)
                measured_min[2] = min(measured_min[2], z)
                measured_max[0] = max(measured_max[0], x)
                measured_max[1] = max(measured_max[1], y)
                measured_max[2] = max(measured_max[2], z)
                if point_in_tile(x, y):
                    in_tile_points += 1

    if total_points != header_point_count:
        raise RuntimeError(f"LAS header point_count {header_point_count} != decoded {total_points}")

    classes = summarize_classifications(class_counts.elements())
    density = in_tile_points / TILE_AREA_M2
    has_reconstruction_classes = {
        "ground": classes["ground_count"] > 0,
        "vegetation": classes["vegetation_count"] > 0,
        "building": classes["building_count"] > 0,
    }
    return {
        "schema": SCHEMA,
        "status": "SOURCE_BYTES_INSPECTED",
        "tile": {
            "id": TILE_ID,
            "horizontal_crs_expected": "EPSG:25832",
            "vertical_datum_expected": "NN2000",
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
            "measured_bounds": {"min": measured_min, "max": measured_max},
            "scales": scales,
            "offsets": offsets,
            "parsed_crs": crs_text,
        },
        "tile_measurement": {
            "points_inside_or_on_tile": in_tile_points,
            "point_density_per_m2": density,
            "classification": classes,
            "has_reconstruction_classes": has_reconstruction_classes,
        },
        "truth": (
            "inspection reports exact decoded source facts only; presence of LAS classes does not by itself prove "
            "roof reconstruction quality, complete individual-tree observation, or production suitability"
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
