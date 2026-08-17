from __future__ import annotations

from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds

from nwe_compiler.raster import RasterContractError, RasterMetadata, inspect_raster, warp_dtm_to_canonical_grid


@dataclass(frozen=True)
class TerrainMosaicMetrics:
    source_count: int
    overlap_pixel_count: int
    max_overlap_delta_m: float
    source_window_width: int
    source_window_height: int


def _grid_shape(bounds: tuple[float, float, float, float], pixel_size: float) -> tuple[int, int]:
    left, bottom, right, top = bounds
    width_f = (right - left) / pixel_size
    height_f = (top - bottom) / pixel_size
    width = round(width_f)
    height = round(height_f)
    if width <= 0 or height <= 0:
        raise RasterContractError("invalid canonical terrain bounds")
    if abs(width_f - width) > 1e-9 or abs(height_f - height) > 1e-9:
        raise RasterContractError("canonical terrain bounds must divide exactly by pixel size")
    return int(width), int(height)


def _validate_source_dataset(dataset, expected_crs: CRS, expected_nodata: float | None) -> float:
    if dataset.crs is None or dataset.crs != expected_crs:
        raise RasterContractError(
            f"all mosaic sources must use {expected_crs.to_string()}, got {dataset.crs}"
        )
    if dataset.count != 1:
        raise RasterContractError("terrain mosaic requires one band per source")
    if dataset.transform.b != 0 or dataset.transform.d != 0:
        raise RasterContractError("rotated/sheared terrain source is outside mosaic contract")
    pixel_x = abs(dataset.transform.a)
    pixel_y = abs(dataset.transform.e)
    if abs(pixel_x - 1.0) > 1e-6 or abs(pixel_y - 1.0) > 1e-6:
        raise RasterContractError(f"terrain mosaic currently requires 1 m sources, got {(pixel_x, pixel_y)}")
    if dataset.nodata is None:
        raise RasterContractError("terrain mosaic source nodata must be explicit")
    nodata = float(dataset.nodata)
    if expected_nodata is not None and nodata != expected_nodata:
        raise RasterContractError(f"terrain mosaic source nodata mismatch: {nodata} != {expected_nodata}")
    return nodata


def warp_dtm_sources_to_canonical_grid(
    sources: Iterable[str | Path],
    destination: str | Path,
    bounds: tuple[float, float, float, float],
    *,
    expected_source_crs: str = "EPSG:25833",
    target_crs: str = "EPSG:25832",
    pixel_size: float = 1.0,
    vertical_datum: str = "NN2000",
    resampling: Resampling = Resampling.bilinear,
    overlap_tolerance_m: float = 0.0,
) -> tuple[RasterMetadata, TerrainMosaicMetrics]:
    """Mosaic exact DTM1 source objects before the canonical CRS warp.

    Single-source calls delegate to the already-proven warp implementation so
    existing Nannestad bytes remain unchanged. Multi-source calls merge only a
    small source-CRS window around the target tile. Overlapping valid raw cells
    must agree within ``overlap_tolerance_m``; otherwise compilation fails rather
    than silently choosing one source at a source-tile seam.
    """

    source_paths = tuple(sorted((Path(path) for path in sources), key=lambda path: str(path)))
    if not source_paths:
        raise RasterContractError("terrain mosaic requires at least one source")
    if overlap_tolerance_m < 0:
        raise RasterContractError("overlap tolerance must be non-negative")
    destination = Path(destination)

    if len(source_paths) == 1:
        metadata = warp_dtm_to_canonical_grid(
            source_paths[0],
            destination,
            bounds,
            expected_source_crs=expected_source_crs,
            target_crs=target_crs,
            pixel_size=pixel_size,
            vertical_datum=vertical_datum,
            resampling=resampling,
        )
        return metadata, TerrainMosaicMetrics(1, 0, 0.0, 0, 0)

    destination.parent.mkdir(parents=True, exist_ok=True)
    source_crs = CRS.from_string(expected_source_crs)
    destination_crs = CRS.from_string(target_crs)
    width, height = _grid_shape(bounds, pixel_size)
    left, _, _, top = bounds
    dst_transform = from_origin(left, top, pixel_size, pixel_size)

    # Densified transform_bounds is used because the canonical/runtime tile and
    # DTM1 source grid are in different projected CRSs. Two source pixels of
    # padding ensure bilinear interpolation has a complete neighbourhood.
    src_window_bounds = transform_bounds(
        destination_crs,
        source_crs,
        *bounds,
        densify_pts=21,
    )
    padding = 2.0
    src_window_bounds = (
        src_window_bounds[0] - padding,
        src_window_bounds[1] - padding,
        src_window_bounds[2] + padding,
        src_window_bounds[3] + padding,
    )

    with rasterio.Env(GDAL_NUM_THREADS="1"):
        with ExitStack() as stack:
            datasets = [stack.enter_context(rasterio.open(path)) for path in source_paths]
            nodata: float | None = None
            for dataset in datasets:
                nodata = _validate_source_dataset(dataset, source_crs, nodata)
            assert nodata is not None

            common = dict(
                bounds=src_window_bounds,
                res=1.0,
                nodata=nodata,
                target_aligned_pixels=True,
                indexes=1,
                mem_limit=64,
            )
            mosaic, mosaic_transform = merge(
                datasets,
                dtype="float32",
                method="first",
                resampling=Resampling.nearest,
                **common,
            )
            minimum, _ = merge(
                datasets,
                dtype="float32",
                method="min",
                resampling=Resampling.nearest,
                **common,
            )
            maximum, _ = merge(
                datasets,
                dtype="float32",
                method="max",
                resampling=Resampling.nearest,
                **common,
            )
            count, _ = merge(
                datasets,
                dtype="uint16",
                nodata=0,
                method="count",
                resampling=Resampling.nearest,
                bounds=src_window_bounds,
                res=1.0,
                target_aligned_pixels=True,
                indexes=1,
                mem_limit=64,
            )

            overlap = count[0] > 1
            overlap_count = int(np.count_nonzero(overlap))
            max_delta = 0.0
            if overlap_count:
                deltas = np.abs(maximum[0][overlap].astype("float64") - minimum[0][overlap].astype("float64"))
                max_delta = float(np.max(deltas))
                if not np.isfinite(max_delta) or max_delta > overlap_tolerance_m:
                    raise RasterContractError(
                        "DTM1 source overlap disagrees before reprojection: "
                        f"max delta {max_delta:.9f} m > tolerance {overlap_tolerance_m:.9f} m"
                    )

            profile = {
                "driver": "GTiff",
                "width": width,
                "height": height,
                "count": 1,
                "dtype": "float32",
                "crs": destination_crs,
                "transform": dst_transform,
                "nodata": nodata,
                "compress": "DEFLATE",
                "zlevel": 6,
                "predictor": 3,
                "interleave": "band",
            }
            with rasterio.open(destination, "w", **profile) as dst:
                reproject(
                    source=mosaic[0],
                    destination=rasterio.band(dst, 1),
                    src_transform=mosaic_transform,
                    src_crs=source_crs,
                    src_nodata=nodata,
                    dst_transform=dst_transform,
                    dst_crs=destination_crs,
                    dst_nodata=nodata,
                    resampling=resampling,
                    num_threads=1,
                    init_dest_nodata=True,
                )
                dst.update_tags(
                    NWE_SCHEMA="nwe.normalized-dtm/0.2",
                    NWE_VERTICAL_DATUM=vertical_datum,
                    NWE_SOURCE_CRS=expected_source_crs,
                    NWE_TARGET_CRS=target_crs,
                    NWE_TRANSFORM="explicit-source-mosaic-reproject-fixed-grid",
                    NWE_RESAMPLING=resampling.name,
                    NWE_PIXEL_SIZE_M=str(pixel_size),
                    NWE_MOSAIC_SOURCE_COUNT=str(len(source_paths)),
                    NWE_MOSAIC_OVERLAP_POLICY="require-match-before-reproject",
                    NWE_MOSAIC_OVERLAP_TOLERANCE_M=str(overlap_tolerance_m),
                )

    result = inspect_raster(destination)
    expected_bounds = tuple(float(value) for value in bounds)
    if result.crs != target_crs or result.width != width or result.height != height:
        raise RasterContractError("mosaic warp output grid contract mismatch")
    if result.pixel_size != (pixel_size, pixel_size):
        raise RasterContractError(f"mosaic warp pixel size mismatch: {result.pixel_size}")
    if any(abs(a - b) > 1e-7 for a, b in zip(result.bounds, expected_bounds, strict=True)):
        raise RasterContractError(f"mosaic warp bounds mismatch: {result.bounds}")
    with rasterio.open(destination) as dataset:
        values = dataset.read(1)
        nodata_count = int(np.count_nonzero(values == dataset.nodata))
    if nodata_count:
        raise RasterContractError(f"mosaic warp left {nodata_count} nodata samples in canonical tile")

    return result, TerrainMosaicMetrics(
        source_count=len(source_paths),
        overlap_pixel_count=overlap_count,
        max_overlap_delta_m=max_delta,
        source_window_width=int(mosaic.shape[2]),
        source_window_height=int(mosaic.shape[1]),
    )
