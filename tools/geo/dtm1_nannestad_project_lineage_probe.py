from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPILER_SRC = ROOT / "engine" / "compiler" / "src"
sys.path.insert(0, str(COMPILER_SRC))

from nwe_compiler.dtm1_nannestad_project_lineage import (  # noqa: E402
    assess_overlap_project_lineage,
    normalize_project_query,
)

SERVICE = "https://hoydedata.no/arcgis/rest/services/DTM/ImageServer/query"
FIELDS = (
    "NAME,LAS_PROJECT_ID,LAS_PROJECT_NAME,PRIORITET,AARSTALL,SISTEFLYDATO,PROSJEKTNR,"
    "HOYDESYSTEM,KOORDINATSYSTEM,OPPLOSNING,DTM_INTERPOLATIONTYPE,CATEGORY,LOWPS,HIGHPS"
)
SAMPLES = {
    "south": (282930.0, 6680996.0),
    "center": (282930.0, 6681000.0),
    "north": (282930.0, 6681004.0),
}


def fetch_json(url: str, timeout: float) -> tuple[dict, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "NorgeWorldEngine-FORGE/1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8")), raw


def query_url(x: float, y: float) -> str:
    params = {
        "f": "json",
        "where": "CATEGORY=1",
        "geometry": f"{x:.1f},{y:.1f}",
        "geometryType": "esriGeometryPoint",
        "inSR": "25833",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": FIELDS,
        "returnGeometry": "false",
    }
    return SERVICE + "?" + urllib.parse.urlencode(params)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    sample_records = {}
    responses = {}
    for name, (x, y) in SAMPLES.items():
        url = query_url(x, y)
        payload, raw = fetch_json(url, args.timeout)
        records = normalize_project_query(payload)
        sample_records[name] = records
        responses[name] = {
            "x": x,
            "y": y,
            "request_url": url,
            "response_bytes": len(raw),
            "response_sha256": hashlib.sha256(raw).hexdigest(),
            "feature_count": len(payload.get("features", [])),
        }

    assessment = assess_overlap_project_lineage(sample_records=sample_records)
    evidence = {
        "schema": "nwe.dtm1-nannestad-project-lineage-proof/0.1",
        "provider_service": SERVICE,
        "provider_surface": "DTM ImageServer primary raster catalog",
        "source_tiles": ["33-125-116", "33-125-117"],
        "measured_overlap_bounds_epsg25833": {
            "xmin": 275425.0,
            "xmax": 290435.0,
            "ymin": 6680995.0,
            "ymax": 6681005.0,
        },
        "samples": responses,
        "assessment": assessment,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2, sort_keys=True))
    if assessment["production_seam_authority"]:
        raise RuntimeError("probe must never grant production seam authority")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
