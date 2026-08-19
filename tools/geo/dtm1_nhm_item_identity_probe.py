#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine" / "compiler" / "src"))

from nwe_compiler.nhm_item_identity import assess_nhm_item_identity_surface  # noqa: E402


SERVICE = "https://hoydedata.no/arcgis/rest/services/NHM_DTM_25833/ImageServer"
ITEMS = {854: "33-125-116", 855: "33-125-117"}


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "NorgeWorldEngine-SENTINEL-NHMIdentity/0.1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"expected JSON object from {url}")
    return value


def item_surface(object_id: int, expected_name: str) -> dict[str, Any]:
    item = fetch_json(f"{SERVICE}/{object_id}?f=pjson")
    attributes = item.get("attributes")
    if not isinstance(attributes, dict):
        raise RuntimeError(f"item {object_id} has no attributes")
    name = attributes.get("NAME")
    if name != expected_name:
        raise RuntimeError(f"item {object_id} expected NAME {expected_name!r}, got {name!r}")
    return {
        "object_id": object_id,
        "name": name,
        "info": fetch_json(f"{SERVICE}/{object_id}/info?f=pjson"),
        "key_properties": fetch_json(f"{SERVICE}/{object_id}/info/keyProperties?f=pjson"),
        "metadata": fetch_json(f"{SERVICE}/{object_id}/info/metadata?f=pjson"),
    }


def run() -> dict[str, Any]:
    service = fetch_json(f"{SERVICE}?f=pjson")
    surfaces = [item_surface(object_id, name) for object_id, name in ITEMS.items()]
    download = fetch_json(f"{SERVICE}/download?rasterIds=854,855&f=pjson")
    result = assess_nhm_item_identity_surface(service, surfaces, download, expected_items=ITEMS)

    # Current provider behavior is itself the evidence gate. If Høydedata starts
    # advertising raw download or source identity, fail so the authority surface
    # is reviewed rather than silently changing the meaning of old evidence.
    if result["service"]["download_capability_advertised"]:
        raise RuntimeError("NHM identity surface changed: Download capability is now advertised; review required")
    if result["download"]["operation_supported"]:
        raise RuntimeError("NHM identity surface changed: Download Rasters is now supported; review required")
    if result["source_identity_fields_exposed"]:
        raise RuntimeError("NHM identity surface changed: item metadata now exposes source identity; review required")
    if result["raw_byte_identity_confirmed"] or result["production_transform_authorized"]:
        raise RuntimeError("diagnostic identity probe must remain fail-closed")

    return {
        "schema": "nwe.dtm1-nhm-item-identity-live-proof/0.1",
        "provider": "Kartverket/Høydedata",
        "service_url": SERVICE,
        "queried_item_ids": sorted(ITEMS),
        "queried_item_names": [ITEMS[object_id] for object_id in sorted(ITEMS)],
        "raw_raster_bytes_downloaded": False,
        "result": result,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    proof = run()
    payload = json.dumps(proof, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
