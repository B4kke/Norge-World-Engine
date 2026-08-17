from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from pyproj import Transformer

TILE_ID = "epsg25832_611000_6677000_1000m"
TILE_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)
NVDB_ENDPOINT = "https://nvdbapiles.atlas.vegvesen.no/vegnett/api/v4/veglenkesekvenser/segmentert"
OSM_ENDPOINT = "https://api.openstreetmap.org/api/0.6/map.json"
USER_AGENT = "NorgeWorldEngine/0.1 prototype-world-compiler"
NVDB_X_CLIENT = "NorgeWorldEngine-Compiler"


class AcquisitionError(RuntimeError):
    pass


@dataclass(frozen=True)
class SourceContract:
    key: str
    source_id: str
    request_url: str
    query_bounds: tuple[float, float, float, float]
    source_crs: str
    source_vertical_datum: str | None
    z_semantics: str
    license_profile: str
    attribution: str
    media_type: str = "application/json"


@dataclass(frozen=True)
class AcquiredSource:
    contract: SourceContract
    raw_bytes: bytes
    raw_sha256: str
    cache_path: str
    cache_hit: bool
    raw_object_count: int
    selected_feature_count: int

    @property
    def byte_size(self) -> int:
        return len(self.raw_bytes)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def transformed_envelope(
    bounds: tuple[float, float, float, float],
    source_crs: str,
    target_crs: str,
) -> tuple[float, float, float, float]:
    """Transform all four corners and return their target-CRS envelope."""
    left, bottom, right, top = bounds
    transformer = Transformer.from_crs(source_crs, target_crs, always_xy=True)
    points = [transformer.transform(x, y) for x in (left, right) for y in (bottom, top)]
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def _fmt(value: float, decimals: int) -> str:
    return f"{value:.{decimals}f}".rstrip("0").rstrip(".")


def nvdb_contract(bounds: tuple[float, float, float, float] = TILE_BOUNDS) -> SourceContract:
    envelope = transformed_envelope(bounds, "EPSG:25832", "EPSG:25833")
    query_bounds = (envelope[0] - 2.0, envelope[1] - 2.0, envelope[2] + 2.0, envelope[3] + 2.0)
    bbox = ",".join(_fmt(value, 3) for value in query_bounds)
    query = urlencode(
        {"kartutsnitt": bbox, "srid": "5973", "antall": "1000", "inkluderAntall": "false"},
        safe=",",
    )
    return SourceContract(
        key="nvdb-roads",
        source_id="statens-vegvesen:nvdb-v4:segmentert-vegnett",
        request_url=f"{NVDB_ENDPOINT}?{query}",
        query_bounds=query_bounds,
        source_crs="EPSG:25833",
        source_vertical_datum="NN2000",
        z_semantics="normal_height_m",
        license_profile="NLOD-1.0",
        attribution="Inneholder data under norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Statens vegvesen.",
    )


def osm_contract(bounds: tuple[float, float, float, float] = TILE_BOUNDS) -> SourceContract:
    # Use all four projected tile corners. Historical browser experiments used
    # only two corners and could omit small slivers at the north/south edges.
    envelope = transformed_envelope(bounds, "EPSG:25832", "EPSG:4326")
    bbox = ",".join(_fmt(value, 15) for value in envelope)
    query = urlencode({"bbox": bbox}, safe=",")
    return SourceContract(
        key="osm-buildings",
        source_id="openstreetmap:api-0.6:map",
        request_url=f"{OSM_ENDPOINT}?{query}",
        query_bounds=envelope,
        source_crs="EPSG:4326",
        source_vertical_datum=None,
        z_semantics="none",
        license_profile="ODbL-1.0",
        attribution="© OpenStreetMap contributors",
    )


def _request_headers(url: str) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if urlparse(url).hostname == "nvdbapiles.atlas.vegvesen.no":
        # NVDB API Les V4 requires callers to identify the client application.
        headers["X-Client"] = NVDB_X_CLIENT
    return headers


def _http_error_detail(exc: HTTPError) -> str:
    request_id = exc.headers.get("X-REQUEST-ID") or exc.headers.get("X-Request-ID") or "missing"
    try:
        body = exc.read(2048).decode("utf-8", errors="replace").strip()
    except Exception:  # pragma: no cover - defensive diagnostic path
        body = ""
    body = " ".join(body.split())[:1200]
    suffix = f"; x-request-id={request_id}"
    if body:
        suffix += f"; body={body}"
    return suffix


def _default_fetch(url: str, timeout: float) -> bytes:
    request = Request(url, headers=_request_headers(url))
    try:
        with urlopen(request, timeout=timeout) as response:
            data = response.read()
            content_type = response.headers.get("Content-Type", "")
            if response.status != 200:
                raise AcquisitionError(f"source HTTP {response.status}: {url}")
            if "json" not in content_type.lower() and not data.lstrip().startswith((b"{", b"[")):
                raise AcquisitionError(f"source did not return JSON: {content_type}")
            return data
    except HTTPError as exc:
        raise AcquisitionError(f"source HTTP {exc.code}: {url}{_http_error_detail(exc)}") from exc


def _validate_and_count(contract: SourceContract, raw_bytes: bytes) -> tuple[int, int]:
    try:
        payload = json.loads(raw_bytes)
    except json.JSONDecodeError as exc:
        raise AcquisitionError(f"{contract.key} returned invalid JSON") from exc

    if contract.key == "nvdb-roads":
        objects = (payload.get("objekter") or payload.get("veglenkesekvenser")) if isinstance(payload, dict) else payload
        if not isinstance(objects, list):
            raise AcquisitionError("NVDB response lacks segmented road array")
        selected = sum(
            1
            for item in objects
            if isinstance(item, dict) and isinstance(item.get("geometri"), dict) and item["geometri"].get("wkt")
        )
        if selected == 0:
            raise AcquisitionError("NVDB response contains no WKT road geometry")
        return len(objects), selected

    if contract.key == "osm-buildings":
        elements = payload.get("elements") if isinstance(payload, dict) else None
        if not isinstance(elements, list):
            raise AcquisitionError("OSM response lacks elements")
        buildings = sum(
            1
            for item in elements
            if isinstance(item, dict)
            and item.get("type") in {"way", "relation"}
            and isinstance(item.get("tags"), dict)
            and item["tags"].get("building")
        )
        if buildings == 0:
            raise AcquisitionError("OSM response contains no building features")
        return len(elements), buildings

    raise AcquisitionError(f"unknown source contract {contract.key}")


def source_snapshot(acquired: AcquiredSource) -> dict:
    contract = acquired.contract
    return {
        "schema": "nwe.source-snapshot/0.3",
        "source_id": contract.source_id,
        "retrieval_identity": {
            "request_url": contract.request_url,
            "query_bounds": [_fmt(value, 15) for value in contract.query_bounds],
            "tile_id": TILE_ID,
        },
        "raw_sha256": acquired.raw_sha256,
        "raw_byte_size": acquired.byte_size,
        "source_crs": contract.source_crs,
        "source_vertical_datum": contract.source_vertical_datum,
        "z_semantics": contract.z_semantics,
        "license_profile": contract.license_profile,
        "attribution": contract.attribution,
        "promotion_state": "VALIDATED_SOURCE",
    }


def _load_cached(contract: SourceContract, cache_dir: Path) -> AcquiredSource | None:
    latest = cache_dir / "latest.json"
    if not latest.exists():
        return None
    try:
        metadata = json.loads(latest.read_text(encoding="utf-8"))
        raw_sha = str(metadata["raw_sha256"])
        raw_path = cache_dir / f"{raw_sha}.json"
        raw = raw_path.read_bytes()
    except (OSError, KeyError, json.JSONDecodeError) as exc:
        raise AcquisitionError(f"invalid raw cache metadata for {contract.key}") from exc
    if sha256_bytes(raw) != raw_sha:
        raise AcquisitionError(f"raw cache SHA mismatch for {contract.key}")
    if metadata.get("request_url") != contract.request_url:
        return None
    raw_count, selected_count = _validate_and_count(contract, raw)
    return AcquiredSource(contract, raw, raw_sha, str(raw_path), True, raw_count, selected_count)


def acquire_source(
    contract: SourceContract,
    cache_root: str | Path,
    *,
    refresh: bool = False,
    offline: bool = False,
    timeout: float = 60.0,
    fetcher: Callable[[str, float], bytes] | None = None,
) -> AcquiredSource:
    cache_dir = Path(cache_root) / "raw" / TILE_ID / contract.key
    cache_dir.mkdir(parents=True, exist_ok=True)

    if not refresh:
        cached = _load_cached(contract, cache_dir)
        if cached is not None:
            return cached
    if offline:
        raise AcquisitionError(f"offline cache miss for {contract.key}")

    raw = (fetcher or _default_fetch)(contract.request_url, timeout)
    raw_count, selected_count = _validate_and_count(contract, raw)
    raw_sha = sha256_bytes(raw)
    raw_path = cache_dir / f"{raw_sha}.json"
    if not raw_path.exists():
        tmp_path = raw_path.with_suffix(".tmp")
        tmp_path.write_bytes(raw)
        os.replace(tmp_path, raw_path)

    metadata = {
        "schema": "nwe.raw-cache-pointer/0.1",
        "source_key": contract.key,
        "request_url": contract.request_url,
        "raw_sha256": raw_sha,
        "raw_byte_size": len(raw),
        "raw_object_count": raw_count,
        "selected_feature_count": selected_count,
        "retrieved_unix_s": int(time.time()),
    }
    latest = cache_dir / "latest.json"
    tmp_latest = latest.with_suffix(".tmp")
    tmp_latest.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp_latest, latest)
    return AcquiredSource(contract, raw, raw_sha, str(raw_path), False, raw_count, selected_count)
