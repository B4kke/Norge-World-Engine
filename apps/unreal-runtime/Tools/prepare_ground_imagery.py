#!/usr/bin/env python3
"""Bake a user-supplied georeferenced RGB image into the exact Nannestad terrain tile.

Intended inputs include a privately licensed/exported orthophoto or an open satellite
GeoTIFF. The source file stays local under user control. The output is a derived 1x1 km
PNG texture plus a provenance/rights manifest below Saved/NWE/PrivateVisual, which is
ignored by Git. This tool does not contact imagery providers.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds

SCHEMA = "nwe.private-ground-imagery/0.1"
TILE_ID = "epsg25832_611000_6677000_1000m"
TARGET_CRS = "EPSG:25832"
TARGET_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)
DEFAULT_SIZE = 2048
ALLOWED_REDISTRIBUTION = {"private-only", "allowed-by-license"}


class GroundImageryError(RuntimeError):
    pass


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _covers_target(source_bounds: tuple[float, float, float, float]) -> bool:
    min_e, min_n, max_e, max_n = source_bounds
    target_min_e, target_min_n, target_max_e, target_max_n = TARGET_BOUNDS
    tolerance = 0.5
    return (
        min_e <= target_min_e + tolerance
        and min_n <= target_min_n + tolerance
        and max_e >= target_max_e - tolerance
        and max_n >= target_max_n - tolerance
    )


def bake_ground_imagery(
    source_path: Path,
    output_root: Path,
    *,
    source_name: str,
    rights_basis: str,
    redistribution: str,
    source_value_max: float | None = None,
    output_size: int = DEFAULT_SIZE,
    bands: tuple[int, int, int] = (1, 2, 3),
) -> dict[str, Any]:
    source_path = source_path.resolve()
    output_root = output_root.resolve()
    if not source_path.is_file():
        raise GroundImageryError(f"imagery source does not exist: {source_path}")
    if not source_name.strip() or not rights_basis.strip():
        raise GroundImageryError("source_name and rights_basis are required")
    if redistribution not in ALLOWED_REDISTRIBUTION:
        raise GroundImageryError(
            f"redistribution must be one of {sorted(ALLOWED_REDISTRIBUTION)}"
        )
    if not (256 <= output_size <= 8192 and output_size & (output_size - 1) == 0):
        raise GroundImageryError("output_size must be a power of two between 256 and 8192")
    if source_value_max is not None and (
        not np.isfinite(source_value_max) or source_value_max <= 0
    ):
        raise GroundImageryError("source_value_max must be positive when supplied")

    with rasterio.open(source_path) as source:
        if source.crs is None:
            raise GroundImageryError("imagery source has no CRS")
        if max(bands) > source.count or min(bands) < 1:
            raise GroundImageryError(
                f"imagery source has {source.count} band(s), requested RGB bands {bands}"
            )
        projected_bounds = transform_bounds(
            source.crs,
            TARGET_CRS,
            *source.bounds,
            densify_pts=21,
        )
        if not _covers_target(projected_bounds):
            raise GroundImageryError(
                f"imagery does not cover the full Nannestad tile: {projected_bounds}"
            )

        target_transform = from_bounds(*TARGET_BOUNDS, output_size, output_size)
        destination = np.zeros((3, output_size, output_size), dtype=np.float32)
        for destination_index, source_band in enumerate(bands):
            reproject(
                source=source.read(source_band),
                destination=destination[destination_index],
                src_transform=source.transform,
                src_crs=source.crs,
                src_nodata=source.nodata,
                dst_transform=target_transform,
                dst_crs=TARGET_CRS,
                dst_nodata=0.0,
                resampling=Resampling.bilinear,
            )
        source_dtype = np.dtype(source.dtypes[bands[0] - 1])

    if source_value_max is None:
        if source_dtype != np.dtype("uint8"):
            raise GroundImageryError(
                f"{source_dtype} imagery requires explicit --source-value-max; "
                "for Sentinel-2 reflectance a reviewed value such as 10000 may be appropriate"
            )
        source_value_max = 255.0

    scaled = np.clip(destination / float(source_value_max), 0.0, 1.0)
    rgb = np.rint(scaled * 255.0).astype(np.uint8)

    output_root.mkdir(parents=True, exist_ok=True)
    texture_path = output_root / "nannestad_ground_color.png"
    target_transform = from_bounds(*TARGET_BOUNDS, output_size, output_size)
    with rasterio.open(
        texture_path,
        "w",
        driver="PNG",
        width=output_size,
        height=output_size,
        count=3,
        dtype="uint8",
        transform=target_transform,
        crs=TARGET_CRS,
    ) as target:
        target.write(rgb)

    source_sha = sha256_path(source_path)
    output_sha = sha256_path(texture_path)
    manifest = {
        "schema": SCHEMA,
        "tile_id": TILE_ID,
        "horizontal_crs": TARGET_CRS,
        "bounds": list(TARGET_BOUNDS),
        "texture": {
            "path": texture_path.name,
            "sha256": output_sha,
            "byte_size": texture_path.stat().st_size,
            "width": output_size,
            "height": output_size,
            "format": "png-rgb8",
            "uv_semantics": "u-west-to-east-v-north-to-south",
        },
        "source": {
            "name": source_name,
            "local_filename": source_path.name,
            "sha256": source_sha,
            "source_value_max": source_value_max,
            "rgb_bands": list(bands),
            "rights_basis": rights_basis,
            "redistribution": redistribution,
            "raw_source_committed": False,
        },
        "transform": {
            "operation": "rasterio-reproject-epsg25832-exact-1km-tile-bilinear-rgb-v0.1",
            "output_pixel_size_m": 1000.0 / output_size,
            "geometry_displacement": False,
        },
    }
    manifest_path = output_root / "ground-imagery.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "status": "PASS",
                "manifest": str(manifest_path),
                "texture": str(texture_path),
                "source_sha256": source_sha,
                "texture_sha256": output_sha,
                "redistribution": redistribution,
            },
            indent=2,
        )
    )
    return manifest


def main() -> int:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-name", required=True)
    parser.add_argument(
        "--rights-basis",
        required=True,
        help="Human-readable basis for local use; this tool does not infer legal rights.",
    )
    parser.add_argument(
        "--redistribution",
        choices=sorted(ALLOWED_REDISTRIBUTION),
        default="private-only",
    )
    parser.add_argument("--source-value-max", type=float)
    parser.add_argument("--output-size", type=int, default=DEFAULT_SIZE)
    parser.add_argument("--red-band", type=int, default=1)
    parser.add_argument("--green-band", type=int, default=2)
    parser.add_argument("--blue-band", type=int, default=3)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=project_root / "Saved" / "NWE" / "PrivateVisual" / "ground",
    )
    args = parser.parse_args()

    bake_ground_imagery(
        args.source,
        args.output_root,
        source_name=args.source_name,
        rights_basis=args.rights_basis,
        redistribution=args.redistribution,
        source_value_max=args.source_value_max,
        output_size=args.output_size,
        bands=(args.red_band, args.green_band, args.blue_band),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
