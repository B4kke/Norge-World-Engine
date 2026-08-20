#!/usr/bin/env python3
"""Probe NIBIO capability endpoints relevant to the ambiguous open SR16 raster record.

GET-only metadata probe. Endpoint failures are evidence and therefore do not fail the script.
No geodata is downloaded.
"""
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

USER_AGENT = "NorgeWorldEngine-NIBIOCapabilityCatalogProbe/0.2 (+https://github.com/B4kke/Norge-World-Engine)"
OPEN_RASTER_UUID = "7df9ef08-faf2-4ad3-9ae2-49905f5ea808"
ACTIVE_RASTER_UUID = "5de45872-f534-4e97-840e-3cfd8db04398"
VECTOR_UUID = "27206b9e-4830-4f71-810d-d04c0dc32b59"
URLS = [
    f"https://kart8.nibio.no/api/capabilities/{OPEN_RASTER_UUID}",
    f"https://kart8.nibio.no/api/v2/capabilities/{OPEN_RASTER_UUID}",
    f"https://kart8.nibio.no/api/v3/capabilities/{OPEN_RASTER_UUID}",
    f"https://kart8.nibio.no/api/capabilities/{ACTIVE_RASTER_UUID}",
    f"https://kart8.nibio.no/api/capabilities/{VECTOR_UUID}",
]
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
            result["reachability"] = "HTTP_SUCCESS_NON_JSON"
            return result
        result["body_kind"] = "json"
        result["top_level_type"] = type(value).__name__
        result["top_level_keys"] = list(value.keys())[:100] if isinstance(value, dict) else None
        result["top_level_count"] = len(value) if isinstance(value, (dict, list)) else None
        result["body_preview"] = compact(value)
        result["reachability"] = "HTTP_SUCCESS_JSON"
    except urllib.error.HTTPError as error:
        result["reachability"] = "HTTP_ERROR"
        result["http_status"] = error.code
        result["error"] = repr(error)
    except (urllib.error.URLError, TimeoutError, RuntimeError) as error:
        result["reachability"] = "TRANSPORT_ERROR"
        result["error"] = repr(error)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    probes = [probe(url) for url in URLS]
    report = {
        "schema": "nwe.nibio-capabilities-catalog-probe/0.2",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "downloads_geodata": False,
        "interpretation_rule": "Endpoint errors are evidence, not probe execution failures.",
        "probes": probes,
        "status": "PASS",
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
