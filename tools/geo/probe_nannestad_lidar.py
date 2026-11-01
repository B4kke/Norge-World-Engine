#!/usr/bin/env python3
"""Probe Kartverket Høydedata metadata for the accepted Nannestad 1×1 km tile.

This is a source-admission probe only. It does not start an export job and does
not download LAZ bytes. The output distinguishes provider unavailability from
"no covering open laser project" so a Høydedata outage cannot be misread as
missing source coverage.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TILE_ID = "epsg25832_611000_6677000_1000m"
HORIZONTAL_CRS = "EPSG:25832"
INPUT_WKID = 25832
TILE_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)
METADATA_ENDPOINT = "https://hoydedata.no/laserservices/rest/projectMetadata.ashx"
USER_AGENT = "NorgeWorldEngine/0.1 nannestad-lidar-source-probe"
SCHEMA = "nwe.nannestad-lidar-source-probe/0.1"


class LidarProbeError(RuntimeError):
    pass


class ProviderUnavailable(LidarProbeError):
    pass


def _closed_coordinate_string(bounds: tuple[float, float, float, float]) -> str:
    min_e, min_n, max_e, max_n = bounds
    points = (
        (min_e, min_n),
        (max_e, min_n),
        (max_e, max_n),
        (min_e, max_n),
        (min_e, min_n),
    )
    return ";".join(f"{int(e)},{int(n)}" for e, n in points)


def metadata_request_payload() -> dict[str, Any]:
    return {
        "Coordinates": _closed_coordinate_string(TILE_BOUNDS),
        "InputWKID": INPUT_WKID,
        "OutputWKID": INPUT_WKID,
        "OutputFormat": "GeoJSON",
        "ReturnMetadata": True,
        "ReturnGeometry": True,
        "StopOnCover": False,
        "Type": 1,
        "Verticaldatum": "NN2000",
    }


def metadata_url() -> str:
    request_json = json.dumps(metadata_request_payload(), ensure_ascii=False, separators=(",", ":"))
    return METADATA_ENDPOINT + "?" + urlencode({"request": request_json})


def _request_json(url: str, timeout: float = 90.0) -> Any:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json,application/geo+json;q=0.9,*/*;q=0.1",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                raise ProviderUnavailable(f"HTTP {status}")
            raw = response.read()
    except HTTPError as exc:
        raise ProviderUnavailable(f"HTTP {exc.code}") from exc
    except URLError as exc:
        raise ProviderUnavailable(f"network error: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ProviderUnavailable("timeout") from exc
    except OSError as exc:
        raise ProviderUnavailable(f"network error: {exc}") from exc

    try:
        return json.loads(raw.decode("utf-8-sig"))
    except Exception as exc:
        raise LidarProbeError("provider response is not valid UTF-8 JSON") from exc


def _casefold_map(value: dict[str, Any]) -> dict[str, tuple[str, Any]]:
    return {str(key).casefold(): (str(key), item) for key, item in value.items()}


def _get_any(value: dict[str, Any], names: tuple[str, ...]) -> Any:
    lowered = _casefold_map(value)
    for name in names:
        hit = lowered.get(name.casefold())
        if hit is not None:
            return hit[1]
    return None


def _looks_like_project(value: dict[str, Any]) -> bool:
    keys = {str(key).casefold() for key in value}
    markers = (
        "prosjektnavn",
        "projectname",
        "prosjekt",
        "project",
        "aarstall",
        "årstall",
        "bestilt_punkttetthet",
        "punkttetthet",
        "tilgang",
        "prosjektnr",
    )
    return any(marker in keys for marker in markers)


def _extract_project_dicts(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        result: list[dict[str, Any]] = []
        for item in payload:
            if isinstance(item, dict):
                if isinstance(item.get("properties"), dict):
                    merged = dict(item["properties"])
                    if item.get("geometry") is not None:
                        merged["_geometry"] = item["geometry"]
                    result.append(merged)
                elif _looks_like_project(item):
                    result.append(item)
        return result

    if not isinstance(payload, dict):
        return []

    if isinstance(payload.get("features"), list):
        return _extract_project_dicts(payload["features"])

    for key in ("projects", "Projects", "results", "Results", "data", "Data"):
        if isinstance(payload.get(key), list):
            return _extract_project_dicts(payload[key])

    if isinstance(payload.get("properties"), dict):
        merged = dict(payload["properties"])
        if payload.get("geometry") is not None:
            merged["_geometry"] = payload["geometry"]
        return [merged]

    return [payload] if _looks_like_project(payload) else []


def _as_number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, str):
        cleaned = value.strip().replace(",", ".")
        try:
            parsed = float(cleaned)
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _as_int(value: Any) -> int | None:
    number = _as_number(value)
    if number is None:
        return None
    rounded = int(number)
    return rounded if abs(number - rounded) < 1e-9 else None


def _project_name(project: dict[str, Any]) -> str | None:
    value = _get_any(
        project,
        ("PROSJEKTNAVN", "PROJECTNAME", "PROSJEKT", "PROJECT", "NAVN", "NAME"),
    )
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _access_state(project: dict[str, Any]) -> tuple[str, Any]:
    raw = _get_any(project, ("TILGANG", "ACCESS"))
    if raw is None:
        return "unknown", None
    normalized = str(raw).strip().casefold()
    if normalized in {"2", "closed", "lukket"}:
        return "closed", raw
    if normalized in {"0", "1", "open", "åpen", "aapen"}:
        return "open", raw
    return "unknown", raw


def _candidate(project: dict[str, Any]) -> dict[str, Any]:
    name = _project_name(project)
    access, access_raw = _access_state(project)
    year = _as_int(_get_any(project, ("AARSTALL", "ÅRSTALL", "YEAR")))
    density = _as_number(
        _get_any(
            project,
            (
                "BESTILT_PUNKTTETTHET",
                "PUNKTTETTHET",
                "POINT_DENSITY",
                "PUNKTER_PR_M2",
            ),
        )
    )
    project_number = _get_any(project, ("PROSJEKTNR", "PROJECTNO", "PROJECTNUMBER"))
    vertical = _get_any(project, ("HOYDESYSTEM", "HØYDESYSTEM", "VERTICALDATUM"))
    crs = _get_any(project, ("KOORDINATSYSTEM", "CRS", "WKID"))
    resolution = _as_number(_get_any(project, ("OPPLOSNING", "OPPLØSNING", "RESOLUTION")))
    return {
        "name": name,
        "project_number": None if project_number is None else str(project_number),
        "year": year,
        "access": access,
        "access_raw": access_raw,
        "ordered_point_density_per_m2": density,
        "resolution_m": resolution,
        "horizontal_crs_raw": crs,
        "vertical_datum_raw": vertical,
        "raw_metadata": project,
    }


def _score(candidate: dict[str, Any]) -> tuple[int, int, float, str]:
    access_score = 2 if candidate["access"] == "open" else 1 if candidate["access"] == "unknown" else 0
    year = candidate["year"] if isinstance(candidate["year"], int) else -1
    density = candidate["ordered_point_density_per_m2"]
    density_score = density if isinstance(density, (int, float)) else -1.0
    name = candidate["name"] or ""
    return (access_score, year, density_score, name.casefold())


def analyze_provider_payload(payload: Any) -> dict[str, Any]:
    projects = _extract_project_dicts(payload)
    candidates = [_candidate(project) for project in projects]
    candidates.sort(key=_score, reverse=True)
    open_candidates = [candidate for candidate in candidates if candidate["access"] == "open"]
    recommended_pool = open_candidates or [candidate for candidate in candidates if candidate["access"] == "unknown"]
    recommended = recommended_pool[0] if recommended_pool else None

    return {
        "schema": SCHEMA,
        "status": "PASS" if candidates else "NO_CANDIDATE",
        "provider": "Kartverket Høydedata",
        "endpoint": METADATA_ENDPOINT,
        "query_url": metadata_url(),
        "tile": {
            "id": TILE_ID,
            "horizontal_crs": HORIZONTAL_CRS,
            "vertical_datum": "NN2000",
            "bounds": list(TILE_BOUNDS),
        },
        "candidate_count": len(candidates),
        "open_candidate_count": len(open_candidates),
        "candidates": candidates,
        "recommended_project": recommended,
        "known_2020_anchor": {
            "name": "Gjerdrum Ullensaker Nannestad 5pkt 2020",
            "project_number": "LACHVI04",
            "source_epoch": 2020,
            "documented_density_points_per_m2": 5,
            "role": "cross-check-only; live provider metadata remains authoritative for acquisition",
        },
        "truth": (
            "metadata/source-admission only; no LAZ bytes downloaded, no point classes or actual "
            "density measured, no roof/tree/terrain reconstruction claim"
        ),
    }


def probe_live(timeout: float = 90.0) -> dict[str, Any]:
    return analyze_provider_payload(_request_json(metadata_url(), timeout=timeout))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--offline-input", help="Replay a saved provider JSON response instead of using network")
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument(
        "--require-open",
        action="store_true",
        help="Fail unless the provider response contains at least one explicitly open project",
    )
    args = parser.parse_args()

    try:
        if args.offline_input:
            payload = json.loads(Path(args.offline_input).read_text(encoding="utf-8"))
            result = analyze_provider_payload(payload)
        else:
            result = probe_live(timeout=args.timeout)
    except ProviderUnavailable as exc:
        result = {
            "schema": SCHEMA,
            "status": "PROVIDER_UNAVAILABLE",
            "provider": "Kartverket Høydedata",
            "endpoint": METADATA_ENDPOINT,
            "query_url": metadata_url(),
            "tile": {
                "id": TILE_ID,
                "horizontal_crs": HORIZONTAL_CRS,
                "vertical_datum": "NN2000",
                "bounds": list(TILE_BOUNDS),
            },
            "error": str(exc),
            "truth": "provider failure is not evidence of missing LiDAR coverage",
        }
        encoded = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if args.output:
            output = Path(args.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(encoded, encoding="utf-8")
        print(encoded, end="")
        return 2

    encoded = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")

    if args.require_open and result.get("open_candidate_count", 0) < 1:
        return 3
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except LidarProbeError as exc:
        print(f"NWE_NANNESTAD_LIDAR_PROBE_REJECTED: {exc}", file=sys.stderr)
        raise SystemExit(1)
