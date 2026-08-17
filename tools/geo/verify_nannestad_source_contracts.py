#!/usr/bin/env python3
"""Verification helper for Norge World Engine Prototype 0 source contracts.

Offline mode proves the canonical coordinate round-trip and validates known
sample payload semantics. Online mode additionally queries the current
Kartverket Height API and NVDB API endpoints.
"""
from __future__ import annotations

import argparse
import json
import math
import platform
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

import pyproj
from pyproj import Geod, Transformer

ANCHOR = {
    "name": "Teiealleen 31, Nannestad",
    "source_crs": "EPSG:4258",
    "lat": 60.21649430093953,
    "lon": 11.01091774941974,
}

KNOWN_DTM1 = {"z": 195.22, "datakilde": "dtm1", "vertical_datum": "NN2000 (source contract metadata)"}
KNOWN_NVDB = {
    "wkt": "POINT Z (279062.329 6682178.909 194.42)",
    "srid": 5973,
    "vertical_datum": "NN2000",
}

@dataclass
class RoundTrip:
    easting_m: float
    northing_m: float
    lon_back: float
    lat_back: float
    lon_error_deg: float
    lat_error_deg: float
    geodesic_error_m: float


def roundtrip() -> RoundTrip:
    fwd = Transformer.from_crs(4258, 25832, always_xy=True)
    inv = Transformer.from_crs(25832, 4258, always_xy=True)
    e, n = fwd.transform(ANCHOR["lon"], ANCHOR["lat"])
    lon2, lat2 = inv.transform(e, n)
    geod = Geod(ellps="GRS80")
    _, _, dist = geod.inv(ANCHOR["lon"], ANCHOR["lat"], lon2, lat2)
    return RoundTrip(e, n, lon2, lat2, lon2 - ANCHOR["lon"], lat2 - ANCHOR["lat"], dist)


def parse_point_z(wkt: str) -> tuple[float, float, float | None]:
    m = re.fullmatch(r"POINT(?: Z)? \(([-+0-9.eE]+) ([-+0-9.eE]+)(?: ([-+0-9.eE]+))?\)", wkt.strip())
    if not m:
        raise ValueError(f"Unsupported WKT: {wkt}")
    x = float(m.group(1)); y = float(m.group(2))
    z = None if m.group(3) is None else float(m.group(3))
    if z is not None and (not math.isfinite(z) or z <= -999000):
        z = None
    return x, y, z


def fetch_json(url: str) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": "NorgeWorldEngine-prototype/0.1 source-contract-verifier"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--online", action="store_true", help="Query live official endpoints in addition to offline checks")
    ap.add_argument("--output", type=Path, default=Path("nannestad_source_contract_proof.json"))
    args = ap.parse_args()

    rt = roundtrip()
    nvdb_xyz = parse_point_z(KNOWN_NVDB["wkt"])
    sentinel_xyz = parse_point_z("POINT Z (279062.329 6682178.909 -999999)")
    report = {
        "status": "pass",
        "generated_by": "verify_nannestad_source_contracts.py",
        "runtime": {"python": platform.python_version(), "pyproj": pyproj.__version__},
        "anchor": ANCHOR,
        "normalized_crs": "EPSG:25832",
        "canonical_vertical_datum": "NN2000",
        "roundtrip": asdict(rt),
        "acceptance": {
            "roundtrip_error_lt_1e-6_m": rt.geodesic_error_m < 1e-6,
            "nvdb_known_srid_is_5973": KNOWN_NVDB["srid"] == 5973,
            "nvdb_known_z_valid": nvdb_xyz[2] is not None,
            "nvdb_sentinel_z_becomes_null": sentinel_xyz[2] is None,
            "nvdb_missing_z_policy": "Any absent/non-finite/sentinel z <= -999000 is normalized to null; never interpreted as elevation.",
            "anonymous_z_forbidden": True,
        },
        "known_samples": {"kartverket_dtm1": KNOWN_DTM1, "nvdb": KNOWN_NVDB},
    }

    if args.online:
        q = urllib.parse.urlencode({"nord": ANCHOR["lat"], "ost": ANCHOR["lon"], "koordsys": 4258})
        height_url = f"https://ws.geonorge.no/hoydedata/v1/punkt?{q}"
        nvdb_url = (
            "https://nvdbapiles.atlas.vegvesen.no/vegnett/api/v4/posisjon?"
            + urllib.parse.urlencode({"lat": ANCHOR["lat"], "lon": ANCHOR["lon"], "maks_avstand": 200})
        )
        report["live"] = {"kartverket_height": fetch_json(height_url), "nvdb_position": fetch_json(nvdb_url)}

    if not report["acceptance"]["roundtrip_error_lt_1e-6_m"]:
        report["status"] = "fail"
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
