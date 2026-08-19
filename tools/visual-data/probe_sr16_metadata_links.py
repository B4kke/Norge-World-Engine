#!/usr/bin/env python3
"""Discover current SR16 raster/vector metadata and distribution contracts without geodata."""
from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import datetime, timezone
from typing import Any

DATASETS = {
    "sr16_raster": "5de45872-f534-4e97-840e-3cfd8db04398",
    "sr16_vector": "27206b9e-4830-4f71-810d-d04c0dc32b59",
}
USER_AGENT = "NorgeWorldEngine-SR16MetadataProbe/0.2 (+https://github.com/B4kke/Norge-World-Engine)"


def fetch_json(url: str) -> tuple[Any, dict[str, Any]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw.decode("utf-8")), {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "bytes": len(raw),
        }


def walk(value: Any, path: tuple[str, ...] = ()):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk(item, path + (str(key),))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk(item, path + (str(index),))
    else:
        yield path, value


def selected_distribution_structures(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    selected = {}
    for key in (
        "DistributionDetails",
        "DistributionFormatsGrouped",
        "DistributionsFormats",
        "Distributions",
    ):
        if key in metadata:
            selected[key] = metadata[key]
    return selected


def probe_one(name: str, uuid: str) -> dict[str, Any]:
    metadata_url = f"https://kartkatalog.geonorge.no/api/getdata/{uuid}"
    metadata, http = fetch_json(metadata_url)
    urls: list[dict[str, str]] = []
    license_fields: list[dict[str, str]] = []
    format_fields: list[dict[str, str]] = []
    for path, value in walk(metadata):
        if not isinstance(value, str):
            continue
        joined = ".".join(path)
        lower_path = joined.lower()
        lower_value = value.lower()
        if value.startswith(("http://", "https://")):
            urls.append({"path": joined, "url": value})
        if any(token in lower_path for token in ("license", "lisens", "rights", "access", "protocol")):
            license_fields.append({"path": joined, "value": value})
        elif any(token in lower_value for token in ("nlod", "norge digitalt", "geovekst")):
            license_fields.append({"path": joined, "value": value})
        if "format" in lower_path or any(token in lower_value for token in ("geotiff", "sosi", "gdb", "gml", "shape")):
            format_fields.append({"path": joined, "value": value})

    urls_rows = sorted({(item["path"], item["url"]) for item in urls})
    license_rows = sorted({(item["path"], item["value"]) for item in license_fields})
    format_rows = sorted({(item["path"], item["value"]) for item in format_fields})
    return {
        "name": name,
        "metadata_uuid": uuid,
        "metadata_http": http,
        "urls": [{"path": path, "url": url} for path, url in urls_rows],
        "license_access_fields": [{"path": path, "value": value} for path, value in license_rows],
        "format_fields": [{"path": path, "value": value} for path, value in format_rows],
        "distribution_structures": selected_distribution_structures(metadata),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    report = {
        "schema": "nwe.sr16-metadata-link-probe/0.2",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "datasets": {name: probe_one(name, uuid) for name, uuid in DATASETS.items()},
        "downloads_geodata": False,
        "status": "PASS",
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
