#!/usr/bin/env python3
"""Discover current SR16 raster/vector metadata and distribution contracts without geodata.

The accepted NWE vegetation baseline is SR16V vector. Raster datasets remain research
candidates and are reported independently so a removed/changed legacy metadata record
cannot falsely invalidate the active runtime source chain.
"""
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

DATASETS = {
    "sr16_raster_split": {
        "metadata_uuid": "5de45872-f534-4e97-840e-3cfd8db04398",
        "active_runtime_required": False,
        "role": "research raster candidate; accepted runtime vegetation uses SR16V vector",
    },
    "sr16_raster_open_legacy_candidate": {
        "metadata_uuid": "7df9ef08-faf2-4ad3-9ae2-49905f5ea808",
        "active_runtime_required": False,
        "role": "legacy/research raster candidate only",
    },
    "sr16_vector": {
        "metadata_uuid": "27206b9e-4830-4f71-810d-d04c0dc32b59",
        "active_runtime_required": True,
        "role": "accepted vegetation source baseline",
    },
}
USER_AGENT = "NorgeWorldEngine-SR16MetadataProbe/0.4 (+https://github.com/B4kke/Norge-World-Engine)"


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


def probe_one(name: str, config: dict[str, Any]) -> dict[str, Any]:
    uuid = str(config["metadata_uuid"])
    metadata_url = f"https://kartkatalog.geonorge.no/api/getdata/{uuid}"
    base = {
        "name": name,
        "metadata_uuid": uuid,
        "active_runtime_required": bool(config["active_runtime_required"]),
        "role": config["role"],
    }
    try:
        metadata, http = fetch_json(metadata_url)
    except urllib.error.HTTPError as error:
        return {
            **base,
            "status": "UNAVAILABLE",
            "metadata_http": {
                "url": metadata_url,
                "status": error.code,
                "reason": error.reason,
            },
            "error": repr(error),
            "urls": [],
            "license_access_fields": [],
            "format_fields": [],
            "temporal_fields": [],
            "distribution_structures": {},
        }
    except Exception as error:
        return {
            **base,
            "status": "UNAVAILABLE",
            "metadata_http": {"url": metadata_url, "status": None},
            "error": repr(error),
            "urls": [],
            "license_access_fields": [],
            "format_fields": [],
            "temporal_fields": [],
            "distribution_structures": {},
        }

    urls: list[dict[str, str]] = []
    license_fields: list[dict[str, str]] = []
    format_fields: list[dict[str, str]] = []
    temporal_fields: list[dict[str, str]] = []
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
        if any(token in lower_path for token in ("date", "updated", "revision", "publication", "temporal")):
            temporal_fields.append({"path": joined, "value": value})

    urls_rows = sorted({(item["path"], item["url"]) for item in urls})
    license_rows = sorted({(item["path"], item["value"]) for item in license_fields})
    format_rows = sorted({(item["path"], item["value"]) for item in format_fields})
    temporal_rows = sorted({(item["path"], item["value"]) for item in temporal_fields})
    return {
        **base,
        "status": "PASS",
        "metadata_http": http,
        "error": None,
        "urls": [{"path": path, "url": url} for path, url in urls_rows],
        "license_access_fields": [{"path": path, "value": value} for path, value in license_rows],
        "format_fields": [{"path": path, "value": value} for path, value in format_rows],
        "temporal_fields": [{"path": path, "value": value} for path, value in temporal_rows],
        "distribution_structures": selected_distribution_structures(metadata),
    }


def classify(datasets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    active_failures = sorted(
        name for name, item in datasets.items()
        if item.get("active_runtime_required") is True and item.get("status") != "PASS"
    )
    research_drift = sorted(
        name for name, item in datasets.items()
        if item.get("active_runtime_required") is not True and item.get("status") != "PASS"
    )
    return {
        "status": "PASS" if not active_failures else "FAIL",
        "active_runtime_status": "PASS" if not active_failures else "FAIL",
        "active_runtime_failures": active_failures,
        "research_drift": research_drift,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    datasets = {name: probe_one(name, config) for name, config in DATASETS.items()}
    classification = classify(datasets)
    report = {
        "schema": "nwe.sr16-metadata-link-probe/0.4",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "datasets": datasets,
        "downloads_geodata": False,
        **classification,
        "truth_guard": "Research-raster metadata drift is retained as evidence but cannot invalidate the accepted SR16V vector runtime dependency. SR16V remains fail-closed.",
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
