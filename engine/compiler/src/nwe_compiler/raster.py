from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from rasterio.windows import Window, from_bounds


class RasterContractError(RuntimeError):
    pass


@dataclass(frozen=True)
class RasterMetadata:
    path: str
    sha256: str
    byte_size: int
    crs: str
    width: int
    height: int
    count: int
    dtype: str
    bounds: tuple[float, float, float, float]
    pixel_size: tuple[float, float]
    nodata: float | int | None

    def as_dict(self) -> dict:
        return asdict(self)


def file_sha256(path: str | Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as fh:
        for chunk in iter(lambda: fh.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_raster(path: str | Path) -> RasterMetadata:
    path = Path(path)
    with rasterio.open(path) as ds:
        if ds.crs is None:
            raise RasterContractError("raster CRS is missing")
        if ds.count < 1:
            raise RasterContractError("raster has no bands")
        if ds.transform.b != 0 or ds.transform.d != 0:
            raise RasterContractError("rotated/sheared rasters are not accepted by Prototype 0 normalizer")
        return RasterMetadata(
            path=str(path),
            sha256=file_sha256(path),
            byte_size=path.stat().st_size,
            crs=ds.crs.to_string(),
            width=ds.width,
            height=ds.height,
            count=ds.count,
            dtype=ds.dtypes[0],
            bounds=(ds.bounds.left, ds.bounds.bottom, ds.bounds.right, ds.bounds.top),
            pixel_size=(abs(ds.transform.a), abs(ds.transform.e)),
            nodata=ds.nodata,
        )


def _integer_window(bounds: Iterable[float], transform, tolerance: float = 1e-7) -> Window:
    window = from_bounds(*bounds, transform=transform)
    values = (window.col_off, window.row_off, window.width, window.height)
    rounded = tuple(round(value) for value in values)
    if any(abs(value - integer) > tolerance for value, integer in zip(values, rounded, strict=True)):
        raise RasterContractError(
            "clip bounds are not aligned to the source pixel grid; resampling must be an explicit transform contract"
        )
    return Window(*rounded)


def _grid_shape(bounds: tuple[float, float, float, float], pixel_size: float) -> tuple[int, int]:
    if pixel_size <= 0:
        raise RasterContractError("pixel size must be positive")
    left, bottom, right, top = bounds
    if not (right > left and top > bottom):
        raise RasterContractError("invalid destination bounds")
    width_f = (right - left) / pixel_size
    height_f = (top - bottom) / pixel_size
    width = round(width_f)
    height = round(height_f)
    if abs(width_f - width) > 1e-9 or abs(height_f - height) > 1e-9:
        raise RasterContractError("destination bounds must divide exactly by pixel size")
    return int(width), int(height)


def warp_dtm_to_canonical_grid(
    source: str | Path,
    destination: str | Path,
    bounds: tuple[float, float, float, float],
    *,
    expected_source_crs: str = "EPSG:25833",
    target_crs: str = "EPSG:25832",
    pixel_size: float = 1.0,
    vertical_datum: str = "NN2000",
    resampling: Resampling = Resampling.bilinear,
) -> RasterMetadata:
    """Explicitly warp a source DTM onto a fixed canonical tile grid.

    This is intentionally a separate transform from `normalize_dtm_clip`.
    Reprojection and interpolation are never hidden inside the no-resampling
    normalizer. Prototype 0 uses a fixed EPSG:25832 1 m grid and bilinear
    interpolation for continuous elevation data.
    """
    source = Path(source)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    width, height = _grid_shape(bounds, pixel_size)
    left, _, _, top = bounds
    dst_transform = from_origin(left, top, pixel_size, pixel_size)
    source_crs = CRS.from_string(expected_source_crs)
    destination_crs = CRS.from_string(target_crs)

    with rasterio.Env(GDAL_NUM_THREADS="1"):
        with rasterio.open(source) as src:
            if src.crs is None:
                raise RasterContractError("source raster CRS is missing")
            if src.crs != source_crs:
                raise RasterContractError(
                    f"expected warp source {expected_source_crs}, got {src.crs.to_string()}"
                )
            if src.count != 1:
                raise RasterContractError(f"Prototype 0 DTM warp requires exactly one band, got {src.count}")
            if src.transform.b != 0 or src.transform.d != 0:
                raise RasterContractError("rotated/sheared DTM1 source is outside the proven Prototype 0 contract")
            if src.nodata is None:
                raise RasterContractError("DTM1 source nodata must be explicit before reprojection")

            profile = {
                "driver": "GTiff",
                "width": width,
                "height": height,
                "count": 1,
                "dtype": "float32",
                "crs": destination_crs,
                "transform": dst_transform,
                "nodata": float(src.nodata),
                "compress": "DEFLATE",
                "zlevel": 6,
                "predictor": 3,
                "interleave": "band",
            }
            with rasterio.open(destination, "w", **profile) as dst:
                reproject(
                    source=rasterio.band(src, 1),
                    destination=rasterio.band(dst, 1),
                    src_transform=src.transform,
                    src_crs=src.crs,
                    src_nodata=src.nodata,
                    dst_transform=dst_transform,
                    dst_crs=destination_crs,
                    dst_nodata=float(src.nodata),
                    resampling=resampling,
                    num_threads=1,
                    init_dest_nodata=True,
                )
                dst.update_tags(
                    NWE_SCHEMA="nwe.normalized-dtm/0.2",
                    NWE_VERTICAL_DATUM=vertical_datum,
                    NWE_SOURCE_CRS=expected_source_crs,
                    NWE_TARGET_CRS=target_crs,
                    NWE_TRANSFORM="explicit-reproject-fixed-grid",
                    NWE_RESAMPLING=resampling.name,
                    NWE_PIXEL_SIZE_M=str(pixel_size),
                )

    result = inspect_raster(destination)
    expected_bounds = tuple(float(value) for value in bounds)
    if result.crs != target_crs:
        raise RasterContractError(f"warped raster CRS mismatch: {result.crs}")
    if result.width != width or result.height != height:
        raise RasterContractError("warped raster dimensions do not match canonical grid")
    if result.pixel_size != (pixel_size, pixel_size):
        raise RasterContractError(f"warped raster pixel size mismatch: {result.pixel_size}")
    if any(abs(a - b) > 1e-7 for a, b in zip(result.bounds, expected_bounds, strict=True)):
        raise RasterContractError(f"warped raster bounds mismatch: {result.bounds}")
    return result


def normalize_dtm_clip(
    source: str | Path,
    destination: str | Path,
    bounds: tuple[float, float, float, float],
    *,
    expected_crs: str = "EPSG:25832",
    vertical_datum: str = "NN2000",
) -> RasterMetadata:
    """Create a deterministic, pixel-aligned single-band DTM clip.

    Implicit reprojection/resampling is deliberately refused. Those operations are
    separate transform-contract steps when a source requires them.
    """
    source = Path(source)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.Env(GDAL_NUM_THREADS="1"):
        with rasterio.open(source) as src:
            if src.crs is None:
                raise RasterContractError("source raster CRS is missing")
            if src.crs != CRS.from_string(expected_crs):
                raise RasterContractError(f"expected {expected_crs}, got {src.crs.to_string()}")
            if src.count < 1:
                raise RasterContractError("source raster has no bands")
            if src.transform.b != 0 or src.transform.d != 0:
                raise RasterContractError("rotated/sheared source requires an explicit warp transform")

            window = _integer_window(bounds, src.transform)
            if not (
                window.col_off >= 0
                and window.row_off >= 0
                and window.col_off + window.width <= src.width
                and window.row_off + window.height <= src.height
            ):
                raise RasterContractError("clip bounds extend outside source raster")

            data = src.read(1, window=window)
            transform = src.window_transform(window)
            profile = {
                "driver": "GTiff",
                "width": int(window.width),
                "height": int(window.height),
                "count": 1,
                "dtype": src.dtypes[0],
                "crs": src.crs,
                "transform": transform,
                "nodata": src.nodata,
                "compress": "DEFLATE",
                "zlevel": 6,
                "interleave": "band",
            }
            with rasterio.open(destination, "w", **profile) as dst:
                dst.write(data, 1)
                dst.update_tags(
                    NWE_SCHEMA="nwe.normalized-dtm/0.1",
                    NWE_VERTICAL_DATUM=vertical_datum,
                    NWE_TRANSFORM="pixel-aligned-window-no-resampling",
                )

    return inspect_raster(destination)
