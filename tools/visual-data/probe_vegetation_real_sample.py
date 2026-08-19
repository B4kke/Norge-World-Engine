#!/usr/bin/env python3
"""Probe bounded real vegetation source bytes for the accepted Nannestad 1 km tile.

The probe intentionally keeps raw provider bytes in /tmp only. The emitted JSON contains
only source-contract/provenance evidence, hashes, schemas and compact sample metadata.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

USER_AGENT = "NorgeWorldEngine-VegetationSampleProbe/0.1 (+https://github.com/B4kke/Norge-World-Engine)"
SR16_ATOM_URL = "https://kartkatalog.nibio.no/api/atom/5de45872-f534-4e97-840e-3cfd8db04398"
AR50_WFS_URL = "https://wfs.nibio.no/cgi-bin/ar50_2"
BOUNDS_25832 = (611000.0, 6677000.0, 612000.0, 6678000.0)


def fetch(url: str, *, accept: str = "application/xml,text/xml,*/*;q=0.5", max_bytes: int = 8 * 1024 * 1024) -> tuple[bytes, dict[str, Any]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read(max_bytes + 1)
        if len(raw) > max_bytes:
            raise RuntimeError(f"SOURCE_RESPONSE_TOO_LARGE: >{max_bytes} bytes from {response.geturl()}")
        return raw, {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "content_length_header": response.headers.get("Content-Length"),
            "last_modified": response.headers.get("Last-Modified"),
            "etag": response.headers.get("ETag"),
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag.split(":", 1)[-1]


def compact_text(value: str | None, limit: int = 220) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split())
    if not value:
        return None
    return value if len(value) <= limit else value[: limit - 1] + "…"


def parse_sr16_atom() -> dict[str, Any]:
    raw, http = fetch(SR16_ATOM_URL, max_bytes=4 * 1024 * 1024)
    root = ET.fromstring(raw)
    entries = []
    for entry in root.iter():
        if local_name(entry.tag) != "entry":
            continue
        title = next((compact_text(child.text) for child in entry if local_name(child.tag) == "title"), None)
        entry_id = next((compact_text(child.text) for child in entry if local_name(child.tag) == "id"), None)
        updated = next((compact_text(child.text) for child in entry if local_name(child.tag) == "updated"), None)
        links = []
        for child in entry:
            if local_name(child.tag) != "link":
                continue
            links.append({
                "rel": child.attrib.get("rel"),
                "type": child.attrib.get("type"),
                "href": child.attrib.get("href"),
                "title": child.attrib.get("title"),
            })
        entries.append({"title": title, "id": entry_id, "updated": updated, "links": links})

    feed_text = raw.decode("utf-8", errors="replace").lower()
    nannestad_mentions = feed_text.count("nannestad") + feed_text.count("3238")
    direct_links = []
    for entry in entries:
        for link in entry["links"]:
            href = link.get("href")
            if not href:
                continue
            if link.get("rel") in ("enclosure", "alternate") or any(token in href.lower() for token in ("download", ".zip", ".tif", ".tiff", ".sos", ".shp")):
                direct_links.append({"entry_title": entry.get("title"), **link})

    return {
        "status": "PASS",
        "http": http,
        "root": local_name(root.tag),
        "entry_count": len(entries),
        "nannestad_or_3238_mentions": nannestad_mentions,
        "entries_preview": entries[:12],
        "candidate_data_links": direct_links[:30],
        "candidate_data_link_count": len(direct_links),
    }


def parse_ar50_capabilities() -> tuple[dict[str, Any], list[str], str]:
    params = urllib.parse.urlencode({"Service": "WFS", "Request": "GetCapabilities"})
    raw, http = fetch(f"{AR50_WFS_URL}?{params}", max_bytes=2 * 1024 * 1024)
    root = ET.fromstring(raw)
    version = root.attrib.get("version") or "1.1.0"
    feature_types: list[dict[str, Any]] = []
    for node in root.iter():
        if local_name(node.tag) != "FeatureType":
            continue
        fields: dict[str, Any] = {}
        for child in node:
            name = local_name(child.tag)
            text = compact_text(child.text)
            if name in ("Name", "Title", "DefaultSRS", "DefaultCRS", "SRS") and text:
                fields.setdefault(name, text)
            elif name in ("OtherSRS", "OtherCRS") and text:
                fields.setdefault(name, []).append(text)
        if fields.get("Name"):
            feature_types.append(fields)
    names = [item["Name"] for item in feature_types]
    return ({
        "status": "PASS" if names else "INCOMPLETE",
        "http": http,
        "wfs_version": version,
        "feature_types": feature_types,
    }, names, version)


def choose_ar50_feature_type(names: list[str]) -> str:
    preferred = [name for name in names if "ar50" in name.lower() and "flate" in name.lower()]
    if preferred:
        return preferred[0]
    preferred = [name for name in names if "ar50" in name.lower()]
    if preferred:
        return preferred[0]
    if names:
        return names[0]
    raise RuntimeError("AR50_FEATURE_TYPE_MISSING")


def parse_ar50_sample(feature_type: str, version: str) -> dict[str, Any]:
    min_e, min_n, max_e, max_n = BOUNDS_25832
    params: dict[str, str] = {
        "service": "WFS",
        "version": version,
        "request": "GetFeature",
        "typeName": feature_type,
        "srsName": "EPSG:25832",
        "bbox": f"{min_e},{min_n},{max_e},{max_n},EPSG:25832",
        "maxFeatures": "50",
    }
    url = f"{AR50_WFS_URL}?{urllib.parse.urlencode(params)}"
    raw, http = fetch(url, max_bytes=8 * 1024 * 1024)
    root = ET.fromstring(raw)
    root_name = local_name(root.tag)
    if root_name.lower().endswith("exceptionreport") or b"ExceptionText" in raw:
        raise RuntimeError(f"AR50_WFS_EXCEPTION: {compact_text(raw.decode('utf-8', errors='replace'), 600)}")

    members = [node for node in root.iter() if local_name(node.tag) in ("featureMember", "member")]
    properties: set[str] = set()
    value_preview: dict[str, list[str]] = {}
    feature_element_names: set[str] = set()
    for member in members[:12]:
        features = list(member)
        for feature in features:
            feature_element_names.add(local_name(feature.tag))
            for child in feature:
                prop = local_name(child.tag)
                properties.add(prop)
                text = compact_text(child.text, 100)
                if text and len(value_preview.setdefault(prop, [])) < 4:
                    value_preview[prop].append(text)

    return {
        "status": "PASS" if members else "EMPTY",
        "http": http,
        "feature_type": feature_type,
        "requested_crs": "EPSG:25832",
        "requested_bounds": list(BOUNDS_25832),
        "feature_member_count_capped": len(members),
        "feature_element_names": sorted(feature_element_names),
        "property_names": sorted(properties),
        "value_preview": {key: value_preview[key] for key in sorted(value_preview)},
        "raw_bytes_retained": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    sr16_atom = parse_sr16_atom()
    ar50_capabilities, names, version = parse_ar50_capabilities()
    feature_type = choose_ar50_feature_type(names)
    ar50_sample = parse_ar50_sample(feature_type, version)

    report = {
        "schema": "nwe.vegetation-real-source-probe/0.1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "tile": {
            "id": "epsg25832_611000_6677000_1000m",
            "horizontal_crs": "EPSG:25832",
            "bounds": list(BOUNDS_25832),
        },
        "policy": {
            "bounded_provider_read": True,
            "commits_raw_geodata": False,
            "uploads_raw_geodata": False,
        },
        "sr16_atom": sr16_atom,
        "ar50_capabilities": ar50_capabilities,
        "ar50_sample": ar50_sample,
    }
    report["status"] = "PASS" if sr16_atom["status"] == "PASS" and ar50_capabilities["status"] == "PASS" and ar50_sample["status"] == "PASS" else "INCOMPLETE"
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
