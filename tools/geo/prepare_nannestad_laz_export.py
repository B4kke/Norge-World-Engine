#!/usr/bin/env python3
"""Prepare or explicitly submit the official Høydedata LAZ export for Nannestad.

The old Høydedata REST export contract documents Format=1 as LAZ and requires
ProjectProduct for project exports, but describes ProjectProduct only as
1=DTM, 2=DOM, 3=DTM+DOM. This tool therefore has *no* ProjectProduct default.
An operator must supply the value explicitly after source/project admission.

No credentials are written to the evidence JSON. Raw LAZ output is not handled
by this tool and must stay outside Git; use inspect_nannestad_laz.py on the
received file before any geometry/reconstruction claim.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SCHEMA = "nwe.nannestad-laz-export-request/0.1"
TILE_ID = "epsg25832_611000_6677000_1000m"
TILE_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)
WKID = 25832
START_EXPORT_ENDPOINT = "https://hoydedata.no/laserservices/rest/startExport.ashx"
USER_AGENT = "NorgeWorldEngine/0.1 nannestad-lidar-export"


class ExportRequestError(RuntimeError):
    pass


def tile_polygon_geojson() -> dict[str, Any]:
    min_e, min_n, max_e, max_n = TILE_BOUNDS
    return {
        "type": "Polygon",
        "coordinates": [[
            [min_e, min_n],
            [max_e, min_n],
            [max_e, max_n],
            [min_e, max_n],
            [min_e, min_n],
        ]],
    }


def build_export_request(
    *,
    project: str,
    project_product: int,
    copy_email: str | None = None,
    username: str | None = None,
    password: str | None = None,
) -> dict[str, Any]:
    project = project.strip()
    if not project:
        raise ExportRequestError("project name is required")
    if project_product not in {1, 2, 3}:
        raise ExportRequestError("ProjectProduct must be explicitly set to 1, 2 or 3")

    email = copy_email.strip() if copy_email else None
    user = username.strip() if username else None
    if not email and not user:
        raise ExportRequestError("CopyEmail is required when Username is not supplied")
    if password and not user:
        raise ExportRequestError("Password cannot be supplied without Username")

    payload: dict[str, Any] = {
        "Name": f"NWE {TILE_ID} LAZ source inspection",
        "CoordInput": tile_polygon_geojson(),
        "InputWkid": WKID,
        "OutputWkid": WKID,
        "CutNationalBorder": 0,
        "Format": 1,
        "Resolution": 0,
        "Projects": project,
        "ProjectProduct": project_product,
        "NHM": 0,
        "MapsheetSize": 0,
        "ProjectMerge": 1,
        "NonOverlappingProjects": 1,
        "ClipToPolygon": 1,
        "Subscription": 0,
    }
    if email:
        payload["CopyEmail"] = email
    if user:
        payload["Username"] = user
    if password:
        payload["Password"] = password
    return payload


def public_evidence(payload: dict[str, Any], *, submitted: bool, provider_response: Any = None) -> dict[str, Any]:
    safe = dict(payload)
    safe.pop("Password", None)
    if "Username" in safe:
        safe["Username"] = "<operator-supplied>"
    if "CopyEmail" in safe:
        safe["CopyEmail"] = "<operator-supplied>"
    return {
        "schema": SCHEMA,
        "status": "SUBMITTED" if submitted else "PREPARED_NOT_SUBMITTED",
        "tile": {
            "id": TILE_ID,
            "horizontal_crs": "EPSG:25832",
            "bounds": list(TILE_BOUNDS),
        },
        "provider": "Kartverket Høydedata",
        "endpoint": START_EXPORT_ENDPOINT,
        "request": safe,
        "provider_response": provider_response if submitted else None,
        "truth": (
            "request preparation/submission only; no LAZ byte identity, point classes, density, "
            "roof geometry or individual-tree observation is proven until the delivered bytes are inspected"
        ),
    }


def submit_export(payload: dict[str, Any], timeout: float = 90.0) -> Any:
    encoded_request = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    url = START_EXPORT_ENDPOINT + "?" + urlencode({"request": encoded_request})
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json,*/*;q=0.5"})
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
            status = getattr(response, "status", 200)
    except HTTPError as exc:
        raise ExportRequestError(f"Høydedata export HTTP {exc.code}") from exc
    except URLError as exc:
        raise ExportRequestError(f"Høydedata export network error: {exc.reason}") from exc
    except (TimeoutError, OSError) as exc:
        raise ExportRequestError(f"Høydedata export network error: {exc}") from exc

    if status != 200:
        raise ExportRequestError(f"Høydedata export HTTP {status}")
    text = raw.decode("utf-8-sig", errors="strict")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw_text": text}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--project-product", required=True, type=int, choices=(1, 2, 3))
    parser.add_argument("--copy-email")
    parser.add_argument("--username")
    parser.add_argument("--password")
    parser.add_argument("--submit", action="store_true", help="Actually start the provider export job")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--timeout", type=float, default=90.0)
    args = parser.parse_args()

    try:
        payload = build_export_request(
            project=args.project,
            project_product=args.project_product,
            copy_email=args.copy_email,
            username=args.username,
            password=args.password,
        )
        provider_response = submit_export(payload, timeout=args.timeout) if args.submit else None
        evidence = public_evidence(payload, submitted=args.submit, provider_response=provider_response)
    except ExportRequestError as exc:
        print(f"NWE_NANNESTAD_LAZ_EXPORT_REJECTED: {exc}", file=sys.stderr)
        return 2

    encoded = json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
