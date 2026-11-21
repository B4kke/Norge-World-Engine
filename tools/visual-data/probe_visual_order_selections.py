#!/usr/bin/env python3
"""Record exact provider order-area objects for Nannestad visual-layer probes.

GET-only. No geodata or order is created here. Active runtime dependencies and research
candidates are classified separately so drift in an unused experiment remains visible
without falsely marking the accepted SR16V/AR50 runtime source chain as unavailable.
"""
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

USER_AGENT = "NorgeWorldEngine-VisualOrderProbe/0.2 (+https://github.com/B4kke/Norge-World-Engine)"

TARGETS = {
    "skyfritt_2025": {
        "url": "https://nedlasting.geonorge.no/api/v3/codelists/area/60ecee84-bd74-430c-92dc-a1a01a05df9e",
        "metadata_uuid": "60ecee84-bd74-430c-92dc-a1a01a05df9e",
        "match": ["t32vpm", "32vpm"],
        "active_runtime_required": False,
        "role": "research-imagery-candidate; current Web runtime uses pinned Sentinel-2 macro colour instead",
    },
    "sr16_raster": {
        "url": "https://kart8.nibio.no/api/v2/codelists/area/5de45872-f534-4e97-840e-3cfd8db04398",
        "metadata_uuid": "5de45872-f534-4e97-840e-3cfd8db04398",
        "match": ["nannestad", "3238"],
        "active_runtime_required": False,
        "role": "research raster candidate; accepted vegetation baseline uses SR16V vector",
    },
    "sr16_vector": {
        "url": "https://kart8.nibio.no/api/v2/codelists/area/27206b9e-4830-4f71-810d-d04c0dc32b59",
        "metadata_uuid": "27206b9e-4830-4f71-810d-d04c0dc32b59",
        "match": ["nannestad", "3238"],
        "active_runtime_required": True,
        "role": "accepted vegetation source baseline",
    },
}


def get_json(url: str) -> tuple[Any, dict[str, Any]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw.decode("utf-8")), {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "bytes": len(raw),
        }


def matches(entry: Any, needles: list[str]) -> bool:
    text = json.dumps(entry, ensure_ascii=False).lower()
    return any(needle in text for needle in needles)


def compact_entry(entry: Any) -> Any:
    if not isinstance(entry, dict):
        return entry
    result = {}
    for key, value in entry.items():
        encoded = json.dumps(value, ensure_ascii=False)
        if len(encoded) <= 20000:
            result[key] = value
        else:
            result[key] = {"omitted_bytes": len(encoded.encode("utf-8"))}
    return result


def probe_target(name: str, config: dict[str, Any]) -> dict[str, Any]:
    base = {
        "metadata_uuid": config["metadata_uuid"],
        "match_terms": config["match"],
        "active_runtime_required": bool(config["active_runtime_required"]),
        "role": config["role"],
    }
    try:
        value, http = get_json(config["url"])
    except Exception as error:
        return {
            **base,
            "http": None,
            "matched_count": 0,
            "matched_entries": [],
            "status": "UNAVAILABLE",
            "error": repr(error),
        }
    entries = value if isinstance(value, list) else []
    selected = [compact_entry(entry) for entry in entries if matches(entry, config["match"])]
    return {
        **base,
        "http": http,
        "matched_count": len(selected),
        "matched_entries": selected,
        "status": "PASS" if len(selected) == 1 else "AMBIGUOUS",
        "error": None,
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

    datasets = {name: probe_target(name, config) for name, config in TARGETS.items()}
    classification = classify(datasets)
    report = {
        "schema": "nwe.visual-source-order-selection-probe/0.2",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "downloads_geodata": False,
        "creates_order": False,
        "datasets": datasets,
        **classification,
        "truth_guard": "Research-candidate drift remains reported but does not invalidate the accepted runtime chain. Any active_runtime_required source remains fail-closed.",
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
