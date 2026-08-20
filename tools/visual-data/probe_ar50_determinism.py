#!/usr/bin/env python3
"""Prove deterministic AR50 source semantics for the accepted Nannestad tile.

The WFS emits request-time `kopidato`, so raw response hashes are expected to differ.
This probe canonicalizes feature semantics while excluding only that volatile field and
requires two independent provider reads to produce the same canonical hash.
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

USER_AGENT = "NorgeWorldEngine-AR50DeterminismProbe/0.1 (+https://github.com/B4kke/Norge-World-Engine)"
WFS_URL = "https://wfs.nibio.no/cgi-bin/ar50_2"
BOUNDS_25832 = (611000.0, 6677000.0, 612000.0, 6678000.0)
VOLATILE_FIELDS = {"kopidato"}
MAX_BYTES = 8 * 1024 * 1024


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag.split(":", 1)[-1]


def normalized_text(text: str | None) -> str | None:
    if text is None:
        return None
    value = " ".join(text.split())
    return value or None


def fetch_sample() -> tuple[bytes, dict[str, Any]]:
    min_e, min_n, max_e, max_n = BOUNDS_25832
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": "ms:AR50",
        "srsName": "EPSG:25832",
        "bbox": f"{min_e},{min_n},{max_e},{max_n},EPSG:25832",
        "count": "50",
    }
    url = f"{WFS_URL}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/gml+xml,text/xml,*/*;q=0.5"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise RuntimeError(f"AR50_RESPONSE_TOO_LARGE>{MAX_BYTES}")
        return raw, {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }


def canonical_node(node: ET.Element) -> Any | None:
    name = local_name(node.tag)
    if name in VOLATILE_FIELDS:
        return None
    children = []
    for child in node:
        normalized = canonical_node(child)
        if normalized is not None:
            children.append(normalized)
    attributes = {
        local_name(key): value
        for key, value in sorted(node.attrib.items(), key=lambda item: local_name(item[0]))
    }
    result: dict[str, Any] = {"name": name}
    text = normalized_text(node.text)
    if attributes:
        result["attributes"] = attributes
    if text:
        result["text"] = text
    if children:
        result["children"] = children
    return result


def extract_features(raw: bytes) -> tuple[list[Any], list[str]]:
    root = ET.fromstring(raw)
    features: list[tuple[str, Any]] = []
    local_ids: list[str] = []
    for member in root.iter():
        if local_name(member.tag) not in ("member", "featureMember"):
            continue
        for feature in member:
            local_id = None
            for descendant in feature.iter():
                if local_name(descendant.tag) == "lokalid":
                    local_id = normalized_text(descendant.text)
                    break
            canonical = canonical_node(feature)
            key = local_id or json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            features.append((key, canonical))
            if local_id:
                local_ids.append(local_id)
    features.sort(key=lambda item: item[0])
    return [item[1] for item in features], sorted(local_ids)


def canonical_hash(raw: bytes) -> tuple[str, int, list[str]]:
    features, local_ids = extract_features(raw)
    encoded = json.dumps(
        {
            "schema": "nwe.ar50-source-semantics/0.1",
            "horizontal_crs": "EPSG:25832",
            "bounds": list(BOUNDS_25832),
            "excluded_volatile_fields": sorted(VOLATILE_FIELDS),
            "features": features,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest(), len(features), local_ids


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    raw_a, http_a = fetch_sample()
    raw_b, http_b = fetch_sample()
    semantic_a, count_a, ids_a = canonical_hash(raw_a)
    semantic_b, count_b, ids_b = canonical_hash(raw_b)

    raw_hash_changed = http_a["sha256"] != http_b["sha256"]
    deterministic = semantic_a == semantic_b and count_a == count_b and ids_a == ids_b and count_a > 0
    report = {
        "schema": "nwe.ar50-determinism-probe/0.1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "tile": {
            "id": "epsg25832_611000_6677000_1000m",
            "horizontal_crs": "EPSG:25832",
            "bounds": list(BOUNDS_25832),
        },
        "volatile_fields_excluded": sorted(VOLATILE_FIELDS),
        "read_a": http_a,
        "read_b": http_b,
        "raw_hash_changed": raw_hash_changed,
        "canonical_hash_a": semantic_a,
        "canonical_hash_b": semantic_b,
        "feature_count_a": count_a,
        "feature_count_b": count_b,
        "local_ids_identical": ids_a == ids_b,
        "local_ids": ids_a,
        "raw_bytes_retained": False,
        "status": "PASS" if deterministic else "FAIL",
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if deterministic else 2


if __name__ == "__main__":
    raise SystemExit(main())
