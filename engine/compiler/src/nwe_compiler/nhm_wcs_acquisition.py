from __future__ import annotations

import hashlib
import json
import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from nwe_compiler.nhm_wcs_source_candidate import (
    VERTICAL_DATUM,
    WCS_COVERAGE,
    WCS_DATASET_ID,
    WCS_ENDPOINT,
    WCS_SERVICE_METADATA_UUID,
    getcoverage_url,
    validate_getcoverage,
)
from nwe_compiler.sources.dtm1_atom import canonical_decimal
from nwe_compiler.tiles import NANNESTAD_TILE, TileSpec

SOURCE_KEY = "terrain-nhm-wcs-25832"
USER_AGENT = "NorgeWorldEngine/0.1 terrain-wcs-compiler"
LICENSE_PROFILE = "CC-BY-4.0"
ATTRIBUTION = "© Kartverket"


class NhmWcsAcquisitionError(RuntimeError):
    pass


@dataclass(frozen=True)
class AcquiredNhmWcsSource:
    raw_path: str
    raw_sha256: str
    raw_byte_size: int
    cache_hit: bool
    retrieval_identity: dict
    raster_metadata: dict
    capabilities_sha256: str
    describe_coverage_sha256: str


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def capabilities_url() -> str:
    return WCS_ENDPOINT + "?" + urllib.parse.urlencode(
        {"SERVICE": "WCS", "VERSION": "1.0.0", "REQUEST": "GetCapabilities"}
    )


def describe_coverage_url() -> str:
    return WCS_ENDPOINT + "?" + urllib.parse.urlencode(
        {
            "SERVICE": "WCS",
            "VERSION": "1.0.0",
            "REQUEST": "DescribeCoverage",
            "COVERAGE": WCS_COVERAGE,
        }
    )


def _http_get(url: str, timeout: float, accept: str) -> tuple[str | None, bytes]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": accept},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if getattr(response, "status", 200) != 200:
            raise NhmWcsAcquisitionError(f"provider returned HTTP {response.status}: {url}")
        return response.headers.get("Content-Type"), response.read()


def _write_exact(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise NhmWcsAcquisitionError(f"content-addressed path collision: {path}")
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _cache_dir(cache_root: str | Path, tile: TileSpec) -> Path:
    return Path(cache_root) / "raw" / tile.tile_id / SOURCE_KEY


def _service_evidence(
    timeout: float,
    fetcher: Callable[[str, float, str], tuple[str | None, bytes]],
) -> tuple[dict, bytes, bytes]:
    cap_url = capabilities_url()
    cap_type, cap = fetcher(
        cap_url,
        timeout,
        "application/xml,text/xml;q=0.9,*/*;q=0.1",
    )
    try:
        root = ET.fromstring(cap)
    except ET.ParseError as exc:
        raise NhmWcsAcquisitionError("WCS GetCapabilities is not valid XML") from exc
    coverages: set[str] = set()
    for element in root.iter():
        if element.tag.split("}")[-1] != "CoverageOfferingBrief":
            continue
        for child in list(element):
            if child.tag.split("}")[-1] == "name" and child.text and child.text.strip():
                coverages.add(child.text.strip())
    if WCS_COVERAGE not in coverages:
        raise NhmWcsAcquisitionError(
            f"expected coverage {WCS_COVERAGE!r} is not advertised: {sorted(coverages)!r}"
        )

    describe_url = describe_coverage_url()
    describe_type, describe = fetcher(
        describe_url,
        timeout,
        "application/xml,text/xml;q=0.9,*/*;q=0.1",
    )
    try:
        describe_root = ET.fromstring(describe)
    except ET.ParseError as exc:
        raise NhmWcsAcquisitionError("WCS DescribeCoverage is not valid XML") from exc
    describe_text = " ".join(
        (element.text or "").strip()
        for element in describe_root.iter()
        if (element.text or "").strip()
    )
    if WCS_COVERAGE not in describe_text:
        raise NhmWcsAcquisitionError("DescribeCoverage does not identify the expected coverage")

    evidence = {
        "capabilities_url": cap_url,
        "capabilities_content_type": cap_type,
        "capabilities_sha256": _sha256(cap),
        "describe_coverage_url": describe_url,
        "describe_coverage_content_type": describe_type,
        "describe_coverage_sha256": _sha256(describe),
        "coverage": WCS_COVERAGE,
        "service_metadata_uuid": WCS_SERVICE_METADATA_UUID,
        "dataset_id": WCS_DATASET_ID,
    }
    return evidence, cap, describe


def _metadata_for_snapshot(validated: dict) -> dict:
    return {
        "crs": validated["crs"],
        "vertical_datum": VERTICAL_DATUM,
        "pixel_size": validated["pixel_size"],
        "bounds": validated["bounds"],
        "nodata": validated["nodata"],
        "width": validated["width"],
        "height": validated["height"],
        "count": validated["count"],
        "dtype": validated["dtype"],
        "valid_samples": validated["valid_samples"],
    }


def _load_cached(cache_root: str | Path, tile: TileSpec) -> AcquiredNhmWcsSource | None:
    cache_dir = _cache_dir(cache_root, tile)
    pointer_path = cache_dir / "latest.json"
    if not pointer_path.exists():
        return None
    try:
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        if pointer.get("tile_id") != tile.tile_id:
            raise NhmWcsAcquisitionError("WCS cache pointer tile identity mismatch")
        raw_sha = str(pointer["raw_sha256"])
        raw_path = cache_dir / f"{raw_sha}.tif"
        if not raw_path.exists():
            raise NhmWcsAcquisitionError("WCS cache pointer references missing raw file")
        raw = raw_path.read_bytes()
        if len(raw) != int(pointer["raw_byte_size"]):
            raise NhmWcsAcquisitionError("WCS cached byte size mismatch")
        if _sha256(raw) != raw_sha:
            raise NhmWcsAcquisitionError("WCS cached SHA mismatch")
        validated = validate_getcoverage(raw_path, tile)
        raster_metadata = _metadata_for_snapshot(validated)
        if raster_metadata != pointer["raster_metadata"]:
            raise NhmWcsAcquisitionError("WCS cached raster metadata mismatch")
        return AcquiredNhmWcsSource(
            raw_path=str(raw_path),
            raw_sha256=raw_sha,
            raw_byte_size=len(raw),
            cache_hit=True,
            retrieval_identity=pointer["retrieval_identity"],
            raster_metadata=raster_metadata,
            capabilities_sha256=str(pointer["capabilities_sha256"]),
            describe_coverage_sha256=str(pointer["describe_coverage_sha256"]),
        )
    except (KeyError, OSError, json.JSONDecodeError) as exc:
        raise NhmWcsAcquisitionError("invalid WCS cache pointer") from exc


def acquire_nhm_wcs(
    cache_root: str | Path,
    *,
    tile: TileSpec = NANNESTAD_TILE,
    refresh: bool = False,
    offline: bool = False,
    timeout: float = 180.0,
    fetcher: Callable[[str, float, str], tuple[str | None, bytes]] | None = None,
) -> AcquiredNhmWcsSource:
    if not refresh:
        cached = _load_cached(cache_root, tile)
        if cached is not None:
            return cached
    if offline:
        raise NhmWcsAcquisitionError(f"offline WCS cache miss for {tile.tile_id}")

    fetch = fetcher or _http_get
    evidence, cap_bytes, describe_bytes = _service_evidence(timeout, fetch)
    request_url = getcoverage_url(tile)
    content_type, raw = fetch(
        request_url,
        timeout,
        "image/tiff,application/geotiff,application/octet-stream;q=0.9,*/*;q=0.1",
    )
    if not raw:
        raise NhmWcsAcquisitionError("WCS GetCoverage returned zero bytes")

    cache_dir = _cache_dir(cache_root, tile)
    cache_dir.mkdir(parents=True, exist_ok=True)
    raw_sha = _sha256(raw)
    raw_path = cache_dir / f"{raw_sha}.tif"
    _write_exact(raw_path, raw)
    validated = validate_getcoverage(raw_path, tile)
    if validated["response_sha256"] != raw_sha or validated["response_byte_size"] != len(raw):
        raise NhmWcsAcquisitionError("WCS byte identity changed during validation")
    if validated["valid_samples"] != validated["width"] * validated["height"]:
        raise NhmWcsAcquisitionError("WCS source contains nodata and cannot be promoted")
    raster_metadata = _metadata_for_snapshot(validated)

    cap_sha = evidence["capabilities_sha256"]
    describe_sha = evidence["describe_coverage_sha256"]
    _write_exact(cache_dir / "service" / f"capabilities-{cap_sha}.xml", cap_bytes)
    _write_exact(cache_dir / "service" / f"describe-{describe_sha}.xml", describe_bytes)

    retrieval_identity = {
        "request_url": request_url,
        "tile_id": tile.tile_id,
        "query_bounds": [canonical_decimal(value) for value in tile.bounds],
        "service_endpoint": WCS_ENDPOINT,
        "service_protocol": "OGC WCS 1.0.0",
        "coverage": WCS_COVERAGE,
        "service_metadata_uuid": WCS_SERVICE_METADATA_UUID,
        "dataset_id": WCS_DATASET_ID,
        "capabilities_sha256": cap_sha,
        "describe_coverage_sha256": describe_sha,
        "response_content_type": content_type,
        "request_crs": "EPSG:25832",
        "response_crs": "EPSG:25832",
        "requested_width": validated["width"],
        "requested_height": validated["height"],
        "requested_format": "GeoTIFF",
    }
    pointer = {
        "schema": "nwe.nhm-wcs-raw-cache-pointer/0.1",
        "tile_id": tile.tile_id,
        "source_key": SOURCE_KEY,
        "raw_sha256": raw_sha,
        "raw_byte_size": len(raw),
        "retrieval_identity": retrieval_identity,
        "raster_metadata": raster_metadata,
        "capabilities_sha256": cap_sha,
        "describe_coverage_sha256": describe_sha,
    }
    latest = cache_dir / "latest.json"
    tmp = latest.with_suffix(".tmp")
    tmp.write_text(json.dumps(pointer, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, latest)

    return AcquiredNhmWcsSource(
        raw_path=str(raw_path),
        raw_sha256=raw_sha,
        raw_byte_size=len(raw),
        cache_hit=False,
        retrieval_identity=retrieval_identity,
        raster_metadata=raster_metadata,
        capabilities_sha256=cap_sha,
        describe_coverage_sha256=describe_sha,
    )


def nhm_wcs_source_snapshot(acquired: AcquiredNhmWcsSource) -> dict:
    metadata = acquired.raster_metadata
    required = ("crs", "vertical_datum", "pixel_size", "bounds", "nodata")
    missing = [key for key in required if key not in metadata]
    if missing:
        raise NhmWcsAcquisitionError("WCS source validation missing " + ",".join(missing))
    if metadata["crs"] != "EPSG:25832":
        raise NhmWcsAcquisitionError("WCS source snapshot requires EPSG:25832")
    if metadata["vertical_datum"] != VERTICAL_DATUM:
        raise NhmWcsAcquisitionError("WCS source snapshot requires NN2000")
    return {
        "schema": "nwe.source-snapshot/0.3",
        "source_id": "kartverket:nhm-dtm-25832-wcs",
        "retrieval_identity": acquired.retrieval_identity,
        "raw_sha256": acquired.raw_sha256,
        "raw_byte_size": acquired.raw_byte_size,
        "source_crs": metadata["crs"],
        "source_vertical_datum": metadata["vertical_datum"],
        "z_semantics": "normal_height_m",
        "pixel_size": [canonical_decimal(float(value)) for value in metadata["pixel_size"]],
        "source_bounds": [canonical_decimal(float(value)) for value in metadata["bounds"]],
        "nodata": (
            canonical_decimal(float(metadata["nodata"]))
            if metadata["nodata"] is not None
            else None
        ),
        "license_profile": LICENSE_PROFILE,
        "attribution": ATTRIBUTION,
        "promotion_state": "VALIDATED_SOURCE",
    }
