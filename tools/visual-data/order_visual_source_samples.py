#!/usr/bin/env python3
"""Create exactly one public sample order for Skyfritt 2025 and SR16 Nannestad.

This tool does not download geodata. It records order receipts and advertised file metadata.
Use it manually; do not put it on a recurring PR schedule.
"""
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

USER_AGENT = "NorgeWorldEngine-VisualSampleOrder/0.1 (+https://github.com/B4kke/Norge-World-Engine)"

TARGETS = {
    "skyfritt_2025": {
        "metadata_uuid": "60ecee84-bd74-430c-92dc-a1a01a05df9e",
        "capabilities": "https://nedlasting.geonorge.no/api/v3/capabilities/60ecee84-bd74-430c-92dc-a1a01a05df9e",
        "area": "https://nedlasting.geonorge.no/api/v3/codelists/area/60ecee84-bd74-430c-92dc-a1a01a05df9e",
        "area_code": "T32VPM",
        "format": "TIFF",
        "projection": "25832",
    },
    "sr16_vector": {
        "metadata_uuid": "27206b9e-4830-4f71-810d-d04c0dc32b59",
        "capabilities": "https://kart8.nibio.no/api/capabilities/27206b9e-4830-4f71-810d-d04c0dc32b59",
        "area": "https://kart8.nibio.no/api/v2/codelists/area/27206b9e-4830-4f71-810d-d04c0dc32b59",
        "area_code": "3238",
        "format": "sosi",
        "projection": "25832",
    },
}


def request_json(url: str, *, payload: Any | None = None) -> tuple[Any, dict[str, Any]]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
        value = json.loads(raw.decode("utf-8")) if raw else None
        return value, {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "bytes": len(raw),
        }


def links(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict):
        return []
    items = value.get("_links") or value.get("links") or []
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def discover_order_url(capabilities: Any) -> str:
    for link in links(capabilities):
        rel = str(link.get("rel", "")).lower()
        href = str(link.get("href", ""))
        if href.startswith(("http://", "https://")) and (rel.endswith("/order") or "/download/order" in rel):
            href = href.replace("http://", "https://", 1)
            if "nedlasting.geonorge.no/api/" in href and "/api/v3/" not in href:
                href = href.replace("/api/", "/api/v3/", 1)
            return href
    raise RuntimeError("provider capabilities did not advertise an order endpoint")


def choose_area(entries: Any, code: str) -> dict[str, Any]:
    matches = [entry for entry in entries if isinstance(entry, dict) and str(entry.get("code")) == code]
    if len(matches) != 1:
        raise RuntimeError(f"area code {code} resolved to {len(matches)} entries")
    return matches[0]


def choose_projection(area: dict[str, Any], code: str) -> dict[str, str]:
    matches = [item for item in area.get("projections", []) if isinstance(item, dict) and str(item.get("code")) == code]
    if len(matches) != 1:
        raise RuntimeError(f"projection {code} resolved to {len(matches)} entries in {area.get('name')}")
    item = matches[0]
    return {key: str(item[key]) for key in ("code", "name", "codespace") if item.get(key) is not None}


def choose_format(area: dict[str, Any], name: str) -> dict[str, str]:
    matches = [item for item in area.get("formats", []) if isinstance(item, dict) and str(item.get("name", "")).lower() == name.lower()]
    if len(matches) != 1:
        # Some providers nest formats under projection only.
        nested = []
        for projection in area.get("projections", []):
            if isinstance(projection, dict):
                nested.extend(item for item in projection.get("formats", []) if isinstance(item, dict))
        matches = [item for item in nested if str(item.get("name", "")).lower() == name.lower()]
    if len(matches) != 1:
        raise RuntimeError(f"format {name} resolved to {len(matches)} entries in {area.get('name')}")
    return {"name": str(matches[0]["name"])}


def sanitize_area(area: dict[str, Any]) -> dict[str, str]:
    return {key: str(area[key]) for key in ("code", "type", "name") if area.get(key) is not None}


def redact_receipt(value: Any) -> Any:
    """Keep provider order/file metadata while removing accidental personal/token fields."""
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            lower = key.lower()
            if lower in {"email", "token", "password", "authorization", "access_token"}:
                result[key] = "<redacted>"
            else:
                result[key] = redact_receipt(item)
        return result
    if isinstance(value, list):
        return [redact_receipt(item) for item in value]
    return value


def order_target(name: str, config: dict[str, str]) -> dict[str, Any]:
    capabilities, cap_http = request_json(config["capabilities"])
    if bool(capabilities.get("deliveryNotificationByEmail")):
        raise RuntimeError(f"{name} unexpectedly requires email; automated public sample order aborted")
    areas, area_http = request_json(config["area"])
    area = choose_area(areas, config["area_code"])
    projection = choose_projection(area, config["projection"])
    format_value = choose_format(area, config["format"])
    order_url = discover_order_url(capabilities)
    payload = {
        "orderLines": [{
            "metadataUuid": config["metadata_uuid"],
            "areas": [sanitize_area(area)],
            "projections": [projection],
            "formats": [format_value],
        }]
    }
    receipt, receipt_http = request_json(order_url, payload=payload)
    return {
        "status": "PASS",
        "capabilities_http": cap_http,
        "area_http": area_http,
        "order_http": receipt_http,
        "selection": payload["orderLines"][0],
        "receipt": redact_receipt(receipt),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    report = {
        "schema": "nwe.visual-source-sample-order/0.1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "downloads_geodata": False,
        "datasets": {},
    }
    failures = 0
    for name, config in TARGETS.items():
        try:
            report["datasets"][name] = order_target(name, config)
        except Exception as error:
            failures += 1
            report["datasets"][name] = {"status": "FAIL", "error": repr(error)}
    report["status"] = "PASS" if failures == 0 else "FAIL"
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
