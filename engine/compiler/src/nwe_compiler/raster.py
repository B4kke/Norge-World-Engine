from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import rasterio
from rasterio.crs import CRS
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
