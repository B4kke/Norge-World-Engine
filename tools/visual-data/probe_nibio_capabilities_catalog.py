#!/usr/bin/env python3
"""Inspect NIBIO's provider capability catalog to resolve metadata UUID vs provider dataset IDs.

GET-only metadata probe. No geodata is downloaded.
"""
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

USER_AGENT = "NorgeWorldEngine-NIBIOCapabilityCatalogProbe/0.1 (+https://github.com/B4kke/Norge-World-Engine)"
URLS = [
    "https://kart8.nibio.no/api/capabilities/",
    "https://kart8.nibio.no/api/capabilities",
    "https://kart8.nibio.no/api/v2/capabilities/",
]
NEEDLES = (
    "sr16",
    "skogressurs",
    "7df9ef08-faf2-4ad3-9ae2-49905f5ea808",
    "5de45872-f534-4e97-840e-3cfd8db04398",
    "27206b9e-4830-4f71-810d-d04c0dc32b59",
)
MAX_BYTES = 2 * 1024 * 1024


def fetch(url: str) -> tuple[bytes, dict[str, Any]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*;q=0.5"})
    with urllib.request.urlopen(request, timeout=45) as response:
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise RuntimeError(f"RESPONSE_TOO_LARGE>{MAX_BYTES}")
        return raw, {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "bytes": len(raw),
        }


def compact(value: Any, depth: int = 0) -> Any:
    if depth >= 4:
        return "<depth-capped>"
    if isinstance(value, dict):
        return {str(key): compact(item, depth + 1) for key, item in list(value.items())[:80]}
    if isinstance(value, list):
        return [compact(item, depth + 1) for item in value[:40]]
    if isinstance(value, str):
        return value if len(value) <= 500 else value[:499] + "…"
    return value


def walk(value: Any, path: tuple[str, ...] = ()):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk(item, path + (str(key),))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk(item, path + (str(index),))
    else:
        yield path, value


def matching_context(value: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path, item in walk(value):
        if not isinstance(item, str):
            continue
        lower = item.lower()
        if not any(needle in lower for needle in NEEDLES):
            continue
        rows.append({"path": ".".join(path), "value": item[:1000]})
        if len(rows) >= 100:
            break
    return rows


def probe(url: str) -> dict[str, Any]:
    result: dict[str, Any] = {"requested_url": url}
    try:
        raw, http = fetch(url)
        result["http"] = http
        text = raw.decode("utf-8", errors="replace")
        try:
            value = json.loads(text)
        except json.JSONDecodeError:
            result["body_kind"] = "text"
            result["body_preview"] = text[:2000]
            result["needle_hits"] = [needle for needle in NEEDLES if needle in text.lower()]
            result["status"] = "PASS"
            return result
        result["body_kind"] = "json"
        result["top_level_type"] = type(value).__name__
        result["top_level_keys"] = list(value.keys())[:100] if isinstance(value, dict) else None
        result["top_level_count"] = len(value) if isinstance(value, (dict, list)) else None
        result["matching_context"] = matching_context(value)
        result["body_preview"] = compact(value)
        result["status"] = "PASS"
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError) as error:
        result["status"] = "ERROR"
        result["error"] = repr(error)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    probes = [probe(url) for url in URLS]
    report = {
        "schema": "nwe.nibio-capabilities-catalog-probe/0.1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "downloads_geodata": False,
        "probes": probes,
        "status": "PASS" if any(item["status"] == "PASS" for item in probes) else "INCOMPLETE",
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
