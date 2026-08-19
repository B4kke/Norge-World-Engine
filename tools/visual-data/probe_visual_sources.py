#!/usr/bin/env python3
"""Probe current open imagery/vegetation source contracts without downloading geodata.

This records only small metadata/capability/codelist/service-capability responses. It never
downloads source TIFF/GDB/GML feature content and is safe to upload as CI evidence.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

DATASETS = {
    "skyfritt_2025": {
        "metadata_uuid": "60ecee84-bd74-430c-92dc-a1a01a05df9e",
        "provider": "Kartverket",
        "purpose": "terrain-colour candidate",
    },
    "sr16_raster": {
        "metadata_uuid": "5de45872-f534-4e97-840e-3cfd8db04398",
        "provider": "NIBIO",
        "purpose": "current split raster dataset; license comparison",
    },
    "sr16_vector": {
        "metadata_uuid": "27206b9e-4830-4f71-810d-d04c0dc32b59",
        "provider": "NIBIO",
        "purpose": "open forest/vegetation vector candidate",
    },
    "ar50_wfs": {
        "mode": "wfs_capabilities",
        "metadata_uuid": "a7949917-033c-4e78-8c0f-e30323ce353a",
        "provider": "NIBIO",
        "purpose": "coarse nationwide non-forest vegetation mask candidate",
        "url": "https://wfs.nibio.no/cgi-bin/ar50_2?Service=WFS&Request=GetCapabilities",
        "required_markers": ["wfs_capabilities", "ar50"],
    },
}

USER_AGENT = "NorgeWorldEngine-VisualSourceProbe/0.3 (+https://github.com/B4kke/Norge-World-Engine)"


def fetch_json(url: str, timeout: float = 30.0) -> tuple[Any, dict[str, Any]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
        value = json.loads(raw.decode("utf-8"))
        return value, {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "bytes": len(raw),
        }


def fetch_text(url: str, timeout: float = 30.0) -> tuple[str, dict[str, Any]]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/xml,text/xml,*/*;q=0.5"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
        return raw.decode("utf-8", errors="replace"), {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "bytes": len(raw),
        }


def all_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from all_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from all_strings(item)


def normalize_capability_url(url: str, metadata_uuid: str) -> str | None:
    value = url.replace("http://", "https://", 1)
    lower = value.lower()
    if "service=wms" in lower or "request=getcapabilities" in lower:
        return None
    if "/api/capabilities" not in lower and "/api/v3/capabilities" not in lower:
        return None
    value = value.rstrip("/")
    if not value.lower().endswith(metadata_uuid.lower()):
        value = f"{value}/{metadata_uuid}"
    if "nedlasting.geonorge.no/api/capabilities/" in value:
        value = value.replace("/api/capabilities/", "/api/v3/capabilities/")
    return value


def capability_urls(metadata: Any, metadata_uuid: str) -> list[str]:
    values = []
    for text in all_strings(metadata):
        if not text.startswith(("https://", "http://")):
            continue
        normalized = normalize_capability_url(text, metadata_uuid)
        if normalized:
            values.append(normalized)
    values.append(f"https://nedlasting.geonorge.no/api/v3/capabilities/{metadata_uuid}")
    return list(dict.fromkeys(values))


def hrefs(value: Any) -> list[str]:
    result = []
    if isinstance(value, dict):
        href = value.get("href")
        if isinstance(href, str) and href.startswith(("https://", "http://")):
            result.append(href.replace("http://", "https://", 1))
        for item in value.values():
            result.extend(hrefs(item))
    elif isinstance(value, list):
        for item in value:
            result.extend(hrefs(item))
    return list(dict.fromkeys(result))


def normalize_geonorge_v3(url: str) -> str:
    if "nedlasting.geonorge.no/api/" in url and "/api/v3/" not in url:
        return url.replace("/api/", "/api/v3/", 1)
    return url


def summarize_codelist(value: Any) -> dict[str, Any]:
    entries = value if isinstance(value, list) else []
    texts = [json.dumps(entry, ensure_ascii=False).lower() for entry in entries]
    return {
        "count": len(entries),
        "supports_epsg_25832": any("25832" in text for text in texts),
        "supports_epsg_25833": any("25833" in text for text in texts),
        "mentions_nannestad": any("nannestad" in text or "3238" in text for text in texts),
        "names": sorted({
            str(entry.get("name"))
            for entry in entries
            if isinstance(entry, dict) and entry.get("name")
        }),
    }


def probe_wfs_capabilities(name: str, config: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {**config, "name": name, "service": None, "errors": []}
    url = str(config["url"])
    try:
        text, http = fetch_text(url)
        lowered = text.lower()
        required = [str(marker).lower() for marker in config.get("required_markers", [])]
        missing = [marker for marker in required if marker not in lowered]
        result["service"] = {
            "http": http,
            "required_markers": required,
            "missing_markers": missing,
        }
        result["status"] = "PASS" if not missing else "INCOMPLETE"
    except Exception as error:
        result["errors"].append({"phase": "service_capabilities", "url": url, "error": repr(error)})
        result["status"] = "INCOMPLETE"
    return result


def probe_download_dataset(name: str, config: dict[str, Any]) -> dict[str, Any]:
    uuid = str(config["metadata_uuid"])
    result: dict[str, Any] = {**config, "name": name, "metadata": None, "capabilities": [], "errors": []}

    metadata_url = f"https://kartkatalog.geonorge.no/api/getdata/{uuid}"
    try:
        metadata, meta_http = fetch_json(metadata_url)
        result["metadata"] = {"http": meta_http}
    except Exception as error:
        metadata = {}
        result["errors"].append({"phase": "metadata", "url": metadata_url, "error": repr(error)})

    for capability_url in capability_urls(metadata, uuid):
        try:
            capabilities, cap_http = fetch_json(capability_url)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            result["errors"].append({"phase": "capabilities", "url": capability_url, "error": repr(error)})
            continue

        cap_entry: dict[str, Any] = {
            "http": cap_http,
            "supports_projection_selection": capabilities.get("supportsProjectionSelection") if isinstance(capabilities, dict) else None,
            "supports_format_selection": capabilities.get("supportsFormatSelection") if isinstance(capabilities, dict) else None,
            "supports_polygon_selection": capabilities.get("supportsPolygonSelection") if isinstance(capabilities, dict) else None,
            "supports_area_selection": capabilities.get("supportsAreaSelection") if isinstance(capabilities, dict) else None,
            "delivery_notification_by_email": capabilities.get("deliveryNotificationByEmail") if isinstance(capabilities, dict) else None,
            "codelists": {},
        }
        for link in hrefs(capabilities):
            normalized = normalize_geonorge_v3(link)
            lower = normalized.lower()
            kind = next((part for part in ("projection", "format", "area") if f"/{part}/" in lower), None)
            if not kind or kind in cap_entry["codelists"]:
                continue
            try:
                codelist, http = fetch_json(normalized)
                cap_entry["codelists"][kind] = {"http": http, "summary": summarize_codelist(codelist)}
            except Exception as error:
                cap_entry["codelists"][kind] = {"url": normalized, "error": repr(error)}
        result["capabilities"].append(cap_entry)
        break

    result["status"] = "PASS" if result["metadata"] and result["capabilities"] else "INCOMPLETE"
    return result


def probe_dataset(name: str, config: dict[str, Any]) -> dict[str, Any]:
    if config.get("mode") == "wfs_capabilities":
        return probe_wfs_capabilities(name, config)
    return probe_download_dataset(name, config)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    report = {
        "schema": "nwe.visual-source-capability-probe/0.3",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "policy": {
            "downloads_geodata": False,
            "committable_evidence_only": True,
            "nannestad_epsg": 25832,
            "nannestad_municipality_number": 3238,
        },
        "datasets": {name: probe_dataset(name, config) for name, config in DATASETS.items()},
    }
    report["status"] = "PASS" if all(item["status"] == "PASS" for item in report["datasets"].values()) else "INCOMPLETE"
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
