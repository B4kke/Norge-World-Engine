from __future__ import annotations

import hashlib
import urllib.parse
from pathlib import Path
from typing import Any

import numpy as np
import rasterio

from nwe_compiler.tiles import TileSpec

WCS_ENDPOINT = "https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25832"
WCS_COVERAGE = "nhm_dtm_topo_25832"
WCS_SERVICE_METADATA_UUID = "05821c51-2f5b-411f-9098-924d13dbea9a"
WCS_DATASET_ID = "8c62e33e-76ba-3c00-9db6-3a10e44135bc"
VERTICAL_DATUM = "NN2000"


class NhmWcsCandidateError(RuntimeError):
    pass


def source_candidate_contract() -> dict[str, Any]:
    """Encode the current evidence boundary for the official NHM DTM WCS.

    This deliberately distinguishes suitability for an isolated compiler
    experiment from selection as the production terrain source. The WCS is an
    official Kartverket download service for the national 1 m DTM and aligns
    directly with Prototype-0 EPSG:25832 tiles. The FvL/Punktsky source family
    documents NN2000 semantics, but the WCS service metadata does not encode a
    compound vertical CRS in each GetCoverage response. Production selection
    therefore remains a separate decision/evidence gate.
    """
    return {
        "schema": "nwe.nhm-wcs-source-candidate/0.1",
        "service": {
            "endpoint": WCS_ENDPOINT,
            "coverage": WCS_COVERAGE,
            "metadata_uuid": WCS_SERVICE_METADATA_UUID,
            "dataset_id": WCS_DATASET_ID,
            "publisher": "Statens kartverk",
            "role": "official national DTM download service",
            "horizontal_crs": "EPSG:25832",
            "resolution_m": 1,
            "vertical_datum": VERTICAL_DATUM,
            "vertical_datum_binding": "FvL/Punktsky source-family contract",
            "access": "public",
        },
        "evidence": {
            "official_download_service": True,
            "national_dtm": True,
            "one_metre_grid_supported": True,
            "runtime_crs_direct_match": True,
            "fvl_source_family_documents_nn2000": True,
            "getcoverage_vertical_crs_explicit": False,
            "prototype_3x3_experiment_eligible": True,
            "production_source_selected": False,
        },
        "claim_calibration": {
            "fact": (
                "Kartverket publishes NHM DTM 25832 WCS as a download service for the national digital terrain model "
                "with 1 m resolution support in EUREF89 / UTM zone 32"
            ),
            "inference": (
                "the WCS may be a cleaner compiler acquisition surface than overlapping Atom packaging because it can "
                "return the exact runtime tile grid directly"
            ),
            "not_proven": (
                "that WCS replaces Atom as the selected production source for NWE, or that its service-level update/composition "
                "semantics are suitable for every future provenance requirement"
            ),
        },
    }


def getcoverage_url(tile: TileSpec) -> str:
    if tile.horizontal_crs != "EPSG:25832":
        raise NhmWcsCandidateError("NHM DTM 25832 WCS requires EPSG:25832 target tiles")
    width_f = tile.bounds[2] - tile.bounds[0]
    height_f = tile.bounds[3] - tile.bounds[1]
    width = round(width_f)
    height = round(height_f)
    if width <= 0 or height <= 0 or abs(width_f - width) > 1e-9 or abs(height_f - height) > 1e-9:
        raise NhmWcsCandidateError("tile bounds must resolve to whole 1 m WCS pixels")
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
        raise NhmWcsCandidateError("GetCoverage response is not a TIFF")
    expected_width = int(round(tile.bounds[2] - tile.bounds[0]))
    expected_height = int(round(tile.bounds[3] - tile.bounds[1]))
    with rasterio.open(path) as dataset:
        crs = dataset.crs.to_string() if dataset.crs else None
        bounds = tuple(float(value) for value in dataset.bounds)
        pixel_size = (abs(float(dataset.transform.a)), abs(float(dataset.transform.e)))
        if crs != tile.horizontal_crs:
            raise NhmWcsCandidateError(f"expected {tile.horizontal_crs}, got {crs}")
        if dataset.width != expected_width or dataset.height != expected_height:
            raise NhmWcsCandidateError(
                f"expected {expected_width}x{expected_height}, got {dataset.width}x{dataset.height}"
            )
        if dataset.count != 1:
            raise NhmWcsCandidateError("expected exactly one WCS elevation band")
        if pixel_size != (1.0, 1.0):
            raise NhmWcsCandidateError(f"expected exact 1 m pixels, got {pixel_size}")
        if any(abs(a - b) > 1e-7 for a, b in zip(bounds, tile.bounds, strict=True)):
            raise NhmWcsCandidateError(f"WCS bounds do not match tile: {bounds} != {tile.bounds}")
        if dataset.transform.b != 0 or dataset.transform.d != 0:
            raise NhmWcsCandidateError("rotated/sheared WCS grids are unsupported")
        data = dataset.read(1, out_dtype="float32")
        nodata = dataset.nodata
        dtype = dataset.dtypes[0]
        transform = tuple(float(value) for value in dataset.transform)[:6]
    valid = np.isfinite(data)
    if nodata is not None and np.isfinite(float(nodata)):
        valid &= data != np.float32(nodata)
    if not np.any(valid):
        raise NhmWcsCandidateError("WCS tile contains no valid elevation samples")
    grid_bytes = np.asarray(data, dtype="<f4", order="C").tobytes(order="C")
    return {
        "tile_id": tile.tile_id,
        "request_url": getcoverage_url(tile),
        "response_sha256": hashlib.sha256(raw).hexdigest(),
        "response_byte_size": len(raw),
        "grid_sha256": hashlib.sha256(grid_bytes).hexdigest(),
        "grid_byte_size": len(grid_bytes),
        "crs": crs,
        "vertical_datum": VERTICAL_DATUM,
        "vertical_datum_binding": "FvL/Punktsky source-family contract",
        "bounds": list(bounds),
        "pixel_size": list(pixel_size),
        "width": expected_width,
        "height": expected_height,
        "count": 1,
        "dtype": dtype,
        "nodata": nodata,
        "transform": list(transform),
        "valid_samples": int(np.count_nonzero(valid)),
        "min_m": float(np.min(data[valid])),
        "max_m": float(np.max(data[valid])),
    }
