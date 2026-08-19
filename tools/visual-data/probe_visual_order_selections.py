#!/usr/bin/env python3
"""Record exact provider order-area objects for the Nannestad visual-layer probes.

GET-only. No geodata or order is created here. Sources that use a direct service contract
(e.g. AR50 WFS) are intentionally not represented as provider-order selections.
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import datetime, timezone
from typing import Any

USER_AGENT = "NorgeWorldEngine-VisualOrderProbe/0.1 (+https://github.com/B4kke/Norge-World-Engine)"

TARGETS = {
    "skyfritt_2025": {
        "url": "https://nedlasting.geonorge.no/api/v3/codelists/area/60ecee84-bd74-430c-92dc-a1a01a05df9e",
        "metadata_uuid": "60ecee84-bd74-430c-92dc-a1a01a05df9e",
        "match": ["t32vpm", "32vpm"],
    },
    "sr16_raster": {
        "url": "https://kart8.nibio.no/api/v2/codelists/area/5de45872-f534-4e97-840e-3cfd8db04398",
        "metadata_uuid": "5de45872-f534-4e97-840e-3cfd8db04398",
        "match": ["nannestad", "3238"],
    },
    "sr16_vector": {
        "url": "https://kart8.nibio.no/api/v2/codelists/area/27206b9e-4830-4f71-810d-d04c0dc32b59",
        "metadata_uuid": "27206b9e-4830-4f71-810d-d04c0dc32b59",
        "match": ["nannestad", "3238"],
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    datasets = {}
    for name, config in TARGETS.items():
        value, http = get_json(config["url"])
        entries = value if isinstance(value, list) else []
        selected = [compact_entry(entry) for entry in entries if matches(entry, config["match"])]
        datasets[name] = {
            "metadata_uuid": config["metadata_uuid"],
            "http": http,
            "match_terms": config["match"],
            "matched_count": len(selected),
            "matched_entries": selected,
            "status": "PASS" if len(selected) == 1 else "AMBIGUOUS",
        }

    report = {
        "schema": "nwe.visual-source-order-selection-probe/0.1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "downloads_geodata": False,
        "creates_order": False,
        "datasets": datasets,
    }
    report["status"] = "PASS" if all(item["status"] == "PASS" for item in datasets.values()) else "AMBIGUOUS"
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
