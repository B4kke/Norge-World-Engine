#!/usr/bin/env python3
"""Discover Høydedata laser projects intersecting the accepted Nannestad tile.

Source discovery uses Kartverket's public Geonorge WFS rather than the legacy
projectMetadata REST endpoint, which returned ``499: Token Required`` during a
2026-11-01 live probe. The WFS BBOX query proves project-footprint intersection
with the exact 1×1 km tile; it does *not* prove that one project completely
covers the tile. Complete usable coverage is measured from delivered LAZ bytes
by ``inspect_nannestad_laz.py``.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SCHEMA = "nwe.nannestad-lidar-source-probe/0.2"
TILE_ID = "epsg25832_611000_6677000_1000m"
HORIZONTAL_CRS = "EPSG:25832"
TILE_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)
WFS_ENDPOINT = "https://wfs.geonorge.no/skwms1/wfs.hoyde-hoydedata-metadata-prosjekt"
WFS_TYPE_NAME = "metadata_prosjekt:Prosjektavgrensning"
LEGACY_METADATA_ENDPOINT = "https://hoydedata.no/laserservices/rest/projectMetadata.ashx"
USER_AGENT = "NorgeWorldEngine/0.1 nannestad-lidar-source-probe"
PROPERTY_NAMES = (
    "LAS_PROJECT_ID",
    "LAS_PROJECT_NAME",
    "TYPE",
    "TILGANG",
    "PROSJEKTNR",
    "KOORDINATSYSTEM",
    "HOYDESYSTEM",
    "PUNKTTETTHET",
    "AARSTALL",
    "SISTEFLYDATO",
    "PUBLISERT",
    "OPPLOSNING",
    "PUBLISHED_DATE",
)


class LidarProbeError(RuntimeError):
    pass


class ProviderUnavailable(LidarProbeError):
    pass


def wfs_url() -> str:
    min_e, min_n, max_e, max_n = TILE_BOUNDS
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": WFS_TYPE_NAME,
        "count": "200",
        "srsName": HORIZONTAL_CRS,
        "bbox": f"{int(min_e)},{int(min_n)},{int(max_e)},{int(max_n)},{HORIZONTAL_CRS}",
        "propertyName": ",".join(PROPERTY_NAMES),
    }
    return WFS_ENDPOINT + "?" + urlencode(params)


def _request_bytes(url: str, timeout: float = 90.0) -> bytes:
    request = Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/gml+xml,application/xml,text/xml;q=0.9,*/*;q=0.1"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                raise ProviderUnavailable(f"HTTP {status}")
            return response.read()
    except HTTPError as exc:
        raise ProviderUnavailable(f"HTTP {exc.code}") from exc
    except URLError as exc:
        raise ProviderUnavailable(f"network error: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ProviderUnavailable("timeout") from exc
    except OSError as exc:
        raise ProviderUnavailable(f"network error: {exc}") from exc


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_wfs_gml(raw: bytes) -> tuple[list[dict[str, str]], int | None, int | None]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise LidarProbeError(f"public WFS returned malformed/truncated XML: {exc}") from exc

    exceptions = [
        " ".join("".join(node.itertext()).split())
        for node in root.iter()
        if _local_name(node.tag) in {"ExceptionText", "ServiceException"}
    ]
    if exceptions:
        raise LidarProbeError("public WFS exception: " + " | ".join(exceptions))
    if _local_name(root.tag) != "FeatureCollection":
        raise LidarProbeError(f"unexpected WFS root element: {_local_name(root.tag)}")

    def attr_int(name: str) -> int | None:
        value = root.attrib.get(name)
        if value is None or not value.isdigit():
            return None
        return int(value)

    projects: list[dict[str, str]] = []
    for member in root.iter():
        if _local_name(member.tag) not in {"member", "featureMember"}:
            continue
        feature = next(iter(member), None)
        if feature is None:
            continue
        props: dict[str, str] = {}
        for child in feature:
            key = _local_name(child.tag)
            text = " ".join("".join(child.itertext()).split())
            if text:
                props[key] = text
        if props:
            projects.append(props)
    return projects, attr_int("numberMatched"), attr_int("numberReturned")


def _as_number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, str):
        try:
            parsed = float(value.strip().replace(",", "."))
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _as_int(value: Any) -> int | None:
    number = _as_number(value)
    if number is None:
        return None
    integer = int(number)
    return integer if abs(number - integer) < 1e-9 else None


def _access_state(value: Any) -> str:
    normalized = str(value).strip().casefold() if value is not None else ""
    if normalized in {"1", "open", "åpen", "aapen"}:
        return "open"
    if normalized in {"2", "closed", "lukket"}:
        return "closed"
    return "unknown"


def _frame_compatible(horizontal: Any, vertical: Any) -> bool:
    horizontal_value = str(horizontal).strip().casefold() if horizontal is not None else ""
    vertical_value = str(vertical).strip().casefold() if vertical is not None else ""
    horizontal_ok = horizontal_value in {"25832", "epsg:25832"}
    # EPSG:5941 is NN2000:2018 height, the vertical frame used by the admitted
    # source-era datasets in this tile. Newer EPSG revisions must be admitted
    # explicitly rather than silently treated as byte-equivalent.
    vertical_ok = vertical_value in {"5941", "epsg:5941", "nn2000", "nn2000:2018"}
    return horizontal_ok and vertical_ok


def _candidate(project: dict[str, Any]) -> dict[str, Any]:
    project_type = _as_int(project.get("TYPE"))
    published_raw = project.get("PUBLISERT")
    published = str(published_raw).strip().casefold() == "published" if published_raw is not None else None
    horizontal = project.get("KOORDINATSYSTEM")
    vertical = project.get("HOYDESYSTEM")
    return {
        "project_id": None if project.get("LAS_PROJECT_ID") is None else str(project.get("LAS_PROJECT_ID")),
        "name": None if project.get("LAS_PROJECT_NAME") is None else str(project.get("LAS_PROJECT_NAME")).strip(),
        "project_number": None if project.get("PROSJEKTNR") is None else str(project.get("PROSJEKTNR")).strip(),
        "project_type": project_type,
        "project_type_label": "laser" if project_type == 1 else "non-laser-or-unknown",
        "access": _access_state(project.get("TILGANG")),
        "access_raw": project.get("TILGANG"),
        "published": published,
        "published_raw": published_raw,
        "year": _as_int(project.get("AARSTALL")),
        "last_flight_date": project.get("SISTEFLYDATO"),
        "published_date": project.get("PUBLISHED_DATE"),
        "ordered_point_density_per_m2": _as_number(project.get("PUNKTTETTHET")),
        "resolution_m": _as_number(project.get("OPPLOSNING")),
        "horizontal_crs_raw": horizontal,
        "vertical_datum_raw": vertical,
        "frame_compatible_with_nannestad": _frame_compatible(horizontal, vertical),
        "raw_metadata": project,
    }


def _score(candidate: dict[str, Any]) -> tuple[int, int, int, int, float, str]:
    open_score = 2 if candidate["access"] == "open" else 1 if candidate["access"] == "unknown" else 0
    published_score = 1 if candidate["published"] is True else 0
    frame_score = 1 if candidate["frame_compatible_with_nannestad"] else 0
    year = candidate["year"] if isinstance(candidate["year"], int) else -1
    density = candidate["ordered_point_density_per_m2"]
    density_score = float(density) if isinstance(density, (int, float)) else -1.0
    return (open_score, published_score, frame_score, year, density_score, (candidate["name"] or "").casefold())


def analyze_wfs_projects(
    projects: list[dict[str, Any]],
    *,
    number_matched: int | None = None,
    number_returned: int | None = None,
) -> dict[str, Any]:
    overlaps = [_candidate(project) for project in projects]
    laser = [candidate for candidate in overlaps if candidate["project_type"] == 1]
    laser.sort(key=_score, reverse=True)
    open_laser = [candidate for candidate in laser if candidate["access"] == "open"]
    admissible = [
        candidate
        for candidate in open_laser
        if candidate["published"] is True and candidate["frame_compatible_with_nannestad"]
    ]
    recommended = admissible[0] if admissible else None
    unresolved = (
        max(0, number_returned - len(projects))
        if isinstance(number_returned, int)
        else None
    )
    return {
        "schema": SCHEMA,
        "status": "PASS" if laser else "NO_LASER_CANDIDATE",
        "provider": "Kartverket / Geonorge Høydedata Metadata prosjekt WFS",
        "endpoint": WFS_ENDPOINT,
        "query_url": wfs_url(),
        "tile": {
            "id": TILE_ID,
            "horizontal_crs": HORIZONTAL_CRS,
            "vertical_datum_expected": "NN2000",
            "bounds": list(TILE_BOUNDS),
        },
        "wfs_number_matched": number_matched,
        "wfs_number_returned": number_returned,
        "metadata_complete_feature_count": len(projects),
        "unresolved_wfs_feature_count": unresolved,
        "provider_response_metadata_complete": unresolved == 0 if unresolved is not None else None,
        "overlap_candidate_count": len(overlaps),
        "laser_candidate_count": len(laser),
        "open_laser_candidate_count": len(open_laser),
        "admissible_open_laser_candidate_count": len(admissible),
        "candidates": laser,
        "recommended_project": recommended,
        "known_cross_checks": [
            {
                "name": "Gjerdrum Ullensaker Nannestad 5pkt 2020",
                "project_number": "LACHVI04",
                "documented_density_points_per_m2": 5,
                "observed_access": "closed (TILGANG=2)",
                "role": "cross-check only; current public WFS rejects it as anonymous/open acquisition source",
            },
            {
                "name": "Romerike laser 2025",
                "project_number": "LACIAK53",
                "observed_project_state": "pågående",
                "role": "freshness cross-check only; do not prefer until delivered/published source overlaps the tile",
            },
        ],
        "legacy_metadata_endpoint": {
            "url": LEGACY_METADATA_ENDPOINT,
            "observed_2026_11_01": "499 Token Required",
            "role": "not used for public source discovery",
        },
        "truth": (
            "WFS BBOX proves project-footprint intersection with the exact tile only. Provider-declared returned "
            "features without requested metadata are reported as unresolved and are not silently admitted. Complete "
            "1x1 km coverage, actual delivered density/classification, roof reconstruction quality and observed "
            "individual trees require clipped LAZ byte inspection."
        ),
    }


def probe_live(timeout: float = 90.0) -> dict[str, Any]:
    projects, number_matched, number_returned = parse_wfs_gml(_request_bytes(wfs_url(), timeout=timeout))
    return analyze_wfs_projects(projects, number_matched=number_matched, number_returned=number_returned)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--offline-input", type=Path, help="Replay a saved WFS GML response instead of using network")
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument("--require-open", action="store_true")
    args = parser.parse_args()

    try:
        if args.offline_input:
            projects, number_matched, number_returned = parse_wfs_gml(args.offline_input.read_bytes())
            result = analyze_wfs_projects(
                projects,
                number_matched=number_matched,
                number_returned=number_returned,
            )
        else:
            result = probe_live(timeout=args.timeout)
    except ProviderUnavailable as exc:
        result = {
            "schema": SCHEMA,
            "status": "PROVIDER_UNAVAILABLE",
            "provider": "Kartverket / Geonorge Høydedata Metadata prosjekt WFS",
            "endpoint": WFS_ENDPOINT,
            "tile": {"id": TILE_ID, "bounds": list(TILE_BOUNDS)},
            "error": str(exc),
            "truth": "provider failure is not evidence of missing LiDAR coverage",
        }
        encoded = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(encoded, encoding="utf-8")
        print(encoded, end="")
        return 2
    except LidarProbeError as exc:
        result = {
            "schema": SCHEMA,
            "status": "PROVIDER_INVALID_RESPONSE",
            "provider": "Kartverket / Geonorge Høydedata Metadata prosjekt WFS",
            "endpoint": WFS_ENDPOINT,
            "tile": {"id": TILE_ID, "bounds": list(TILE_BOUNDS)},
            "error": str(exc),
            "truth": "invalid/truncated provider response is not evidence of missing LiDAR coverage",
        }
        encoded = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(encoded, encoding="utf-8")
        print(encoded, end="")
        return 2

    encoded = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    if args.require_open and result.get("admissible_open_laser_candidate_count", 0) < 1:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
