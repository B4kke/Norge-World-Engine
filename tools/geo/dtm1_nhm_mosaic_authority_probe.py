from __future__ import annotations

import argparse
import hashlib
import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from nwe_compiler.nhm_mosaic_authority import assess_nhm_mosaic_authority


DEFAULT_SERVICE_URL = "https://hoydedata.no/arcgis/rest/services/NHM_DTM_25833/ImageServer"
DEFAULT_SOURCE_NAMES = ("33-125-116", "33-125-117")


def _fetch_json(url: str, *, timeout: float) -> tuple[dict[str, Any], str, int]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "NorgeWorldEngine/0.1 dtm1-nhm-mosaic-authority-probe",
            "Accept": "application/json,text/plain;q=0.9,*/*;q=0.1",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read()
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}: {url}")
    try:
        decoded = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"provider response is not JSON: {url}") from exc
    if not isinstance(decoded, dict):
        raise RuntimeError(f"provider JSON root must be an object: {url}")
    return decoded, hashlib.sha256(payload).hexdigest(), len(payload)


def _catalog_query_url(service_url: str, source_names: tuple[str, str]) -> str:
    quoted = ",".join(f"'{name.replace("'", "''")}'" for name in source_names)
    params = urllib.parse.urlencode(
        {
            "where": f"NAME IN ({quoted})",
            "outFields": "OBJECTID,NAME,MINPS,MAXPS,LOWPS,HIGHPS,CATEGORY,ZORDER",
            "returnGeometry": "true",
            "f": "pjson",
        }
    )
    return f"{service_url.rstrip('/')}/query?{params}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Capture provider-published NHM DTM mosaic metadata/catalog evidence without "
            "promoting it into a DTM1 seam TransformContract."
        )
    )
    parser.add_argument("--service-url", default=DEFAULT_SERVICE_URL)
    parser.add_argument("--source-a", default=DEFAULT_SOURCE_NAMES[0])
    parser.add_argument("--source-b", default=DEFAULT_SOURCE_NAMES[1])
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source_names = (args.source_a, args.source_b)
    service_url = f"{args.service_url.rstrip('/')}?f=pjson"
    query_url = _catalog_query_url(args.service_url, source_names)
    service, service_sha, service_bytes = _fetch_json(service_url, timeout=args.timeout)
    catalog, catalog_sha, catalog_bytes = _fetch_json(query_url, timeout=args.timeout)
    features = catalog.get("features")
    if not isinstance(features, list):
        raise RuntimeError("NHM catalog query response does not contain a features list")

    assessment = assess_nhm_mosaic_authority(
        service,
        features,
        expected_source_names=source_names,
    )
    result = {
        "schema": "nwe.dtm1-nhm-mosaic-authority-probe/0.1",
        "provider": "Kartverket / Høydedata",
        "service_response": {
            "url": service_url,
            "sha256": service_sha,
            "byte_size": service_bytes,
        },
        "catalog_response": {
            "url": query_url,
            "sha256": catalog_sha,
            "byte_size": catalog_bytes,
        },
        "assessment": assessment,
        "boundary": (
            "Diagnostic metadata/catalog evidence only. No GeoTIFF bytes are downloaded, no seam "
            "policy is selected, and this output cannot satisfy a production TransformContract."
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
