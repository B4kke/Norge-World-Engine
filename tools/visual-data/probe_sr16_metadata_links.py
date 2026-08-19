#!/usr/bin/env python3
"""Discover current SR16 metadata/distribution links without downloading geodata."""
from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import datetime, timezone
from typing import Any

UUID = "5de45872-f534-4e97-840e-3cfd8db04398"
METADATA_URL = f"https://kartkatalog.geonorge.no/api/getdata/{UUID}"
USER_AGENT = "NorgeWorldEngine-SR16MetadataProbe/0.1 (+https://github.com/B4kke/Norge-World-Engine)"


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    metadata, http = fetch_json(METADATA_URL)
    urls: list[dict[str, str]] = []
    license_fields: list[dict[str, str]] = []
    for path, value in walk(metadata):
        if not isinstance(value, str):
            continue
        lower_path = ".".join(path).lower()
        lower_value = value.lower()
        if value.startswith(("http://", "https://")):
            urls.append({"path": ".".join(path), "url": value})
        if any(token in lower_path for token in ("license", "lisens", "rights", "access", "protocol")):
            license_fields.append({"path": ".".join(path), "value": value})
        elif any(token in lower_value for token in ("nlod", "norge digitalt", "geovekst")):
            license_fields.append({"path": ".".join(path), "value": value})

    urls = sorted({(item["path"], item["url"]) for item in urls})
    license_rows = sorted({(item["path"], item["value"]) for item in license_fields})
    report = {
        "schema": "nwe.sr16-metadata-link-probe/0.1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "metadata_uuid": UUID,
        "metadata_http": http,
        "urls": [{"path": path, "url": url} for path, url in urls],
        "license_access_fields": [{"path": path, "value": value} for path, value in license_rows],
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
