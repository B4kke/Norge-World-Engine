from __future__ import annotations

import hashlib
import urllib.parse
from pathlib import Path
from typing import Any

import numpy as np
import rasterio

from nwe_compiler.tiles import TileSpec

WCS_ENDPOINT = "https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25832"
WCS_COVERAGE = "nhm_dom_topo_25832"
WCS_DATASET_ID = "8c62e33e-76ba-3c00-9db6-3a10e44135bc"


class NhmDomWcsCandidateError(RuntimeError):
    pass


def source_candidate_contract() -> dict[str, Any]:
    return {
        "schema": "nwe.nhm-dom-wcs-source-candidate/0.1",
        "service": {
            "endpoint": WCS_ENDPOINT,
            "coverage": WCS_COVERAGE,
            "dataset_id": WCS_DATASET_ID,
            "publisher": "Statens kartverk",
            "role": "official national digital surface model download service",
            "horizontal_crs": "EPSG:25832",
            "resolution_m": 1,
            "access": "public",
        },
        "evidence": {
            "getcapabilities_live_probe_required": True,
            "raw_topographic_coverage_selected": True,
            "hillshade_coverage_excluded": True,
            "prototype_building_surface_experiment_eligible": True,
            "production_building_source_selected": False,
            "absolute_vertical_datum_independently_bound": False,
        },
        "claim_calibration": {
            "fact": (
                "Kartverket's live NHM DOM EPSG:25832 WCS advertises the raw "
                "nhm_dom_topo_25832 coverage separately from a hillshade coverage"
            ),
            "experiment": (
                "sample the exact Nannestad 1 km DOM grid and compare it with the "
                "accepted NHM DTM grid inside verified building footprints"
            ),
            "not_proven": (
                "that fitted roof planes/shapes are surveyed building geometry, or "
                "that NHM DOM is selected as NWE's production building source"
            ),
        },
    }


def getcoverage_url(tile: TileSpec) -> str:
    if tile.horizontal_crs != "EPSG:25832":
        raise NhmDomWcsCandidateError("NHM DOM 25832 WCS requires EPSG:25832 target tiles")
    width_f = tile.bounds[2] - tile.bounds[0]
    height_f = tile.bounds[3] - tile.bounds[1]
    width = round(width_f)
    height = round(height_f)
    if width <= 0 or height <= 0 or abs(width_f - width) > 1e-9 or abs(height_f - height) > 1e-9:
        raise NhmDomWcsCandidateError("tile bounds must resolve to whole 1 m WCS pixels")
    query = urllib.parse.urlencode(
        {
            "SERVICE": "WCS",
            "VERSION": "1.0.0",
            "REQUEST": "GetCoverage",
            "COVERAGE": WCS_COVERAGE,
            "CRS": "EPSG:25832",
            "RESPONSE_CRS": "EPSG:25832",
            "BBOX": ",".join(str(int(round(value))) for value in tile.bounds),
            "WIDTH": str(width),
            "HEIGHT": str(height),
            "FORMAT": "GeoTIFF",
        }
    )
    return f"{WCS_ENDPOINT}?{query}"


def validate_getcoverage(path: str | Path, tile: TileSpec) -> dict[str, Any]:
    path = Path(path)
    raw = path.read_bytes()
    if raw[:4] not in (b"II*\x00", b"MM\x00*"):
        raise NhmDomWcsCandidateError("DOM GetCoverage response is not a TIFF")
    expected_width = int(round(tile.bounds[2] - tile.bounds[0]))
    expected_height = int(round(tile.bounds[3] - tile.bounds[1]))
    with rasterio.open(path) as dataset:
        crs = dataset.crs.to_string() if dataset.crs else None
        bounds = tuple(float(value) for value in dataset.bounds)
        pixel_size = (abs(float(dataset.transform.a)), abs(float(dataset.transform.e)))
        if crs != tile.horizontal_crs:
            raise NhmDomWcsCandidateError(f"expected {tile.horizontal_crs}, got {crs}")
        if dataset.width != expected_width or dataset.height != expected_height:
            raise NhmDomWcsCandidateError(
                f"expected {expected_width}x{expected_height}, got {dataset.width}x{dataset.height}"
            )
        if dataset.count != 1:
            raise NhmDomWcsCandidateError("expected exactly one DOM elevation band")
        if pixel_size != (1.0, 1.0):
            raise NhmDomWcsCandidateError(f"expected exact 1 m pixels, got {pixel_size}")
        if any(abs(a - b) > 1e-7 for a, b in zip(bounds, tile.bounds, strict=True)):
            raise NhmDomWcsCandidateError(f"DOM WCS bounds do not match tile: {bounds} != {tile.bounds}")
        if dataset.transform.b != 0 or dataset.transform.d != 0:
            raise NhmDomWcsCandidateError("rotated/sheared DOM grids are unsupported")
        data = dataset.read(1, out_dtype="float32")
        nodata = dataset.nodata
        dtype = dataset.dtypes[0]
        transform = tuple(float(value) for value in dataset.transform)[:6]
    valid = np.isfinite(data)
    if nodata is not None and np.isfinite(float(nodata)):
        valid &= data != np.float32(nodata)
    if not np.any(valid):
        raise NhmDomWcsCandidateError("DOM WCS tile contains no valid surface elevation samples")
    grid_bytes = np.asarray(data, dtype="<f4", order="C").tobytes(order="C")
    return {
        "tile_id": tile.tile_id,
        "request_url": getcoverage_url(tile),
        "response_sha256": hashlib.sha256(raw).hexdigest(),
        "response_byte_size": len(raw),
        "grid_sha256": hashlib.sha256(grid_bytes).hexdigest(),
        "grid_byte_size": len(grid_bytes),
        "crs": crs,
        "bounds": list(bounds),
        "pixel_size": list(pixel_size),
        "width": expected_width,
        "height": expected_height,
        "count": 1,
        "dtype": dtype,
        "nodata": nodata,
        "transform": list(transform),
        "valid_samples": int(np.count_nonzero(valid)),
        "min_surface_m": float(np.min(data[valid])),
        "max_surface_m": float(np.max(data[valid])),
        "z_semantics": "surface_elevation_m-provider-grid",
        "vertical_datum_status": "not-independently-bound-by-this-candidate",
    }
