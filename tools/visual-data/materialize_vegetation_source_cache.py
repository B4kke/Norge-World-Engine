#!/usr/bin/env python3
"""Materialize one bounded Nannestad vegetation source cache for offline normalization.

This is a manual/source-gate tool. It resolves the current SR16V Nannestad/EPSG:25832
SOSI snapshot from NIBIO's Atom feed and performs two bounded AR50 WFS reads for the
accepted 1 km tile. Raw provider bytes stay in --work-dir and must never be committed or
uploaded as CI artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from materialize_visual_source_samples import safe_extract_zip, stream_download
from probe_vegetation_real_sample import (
    AR50_WFS_URL,
    BOUNDS_25832,
    SR16_ATOM_URLS,
    compact_text,
    fetch,
    local_name,
    choose_ar50_feature_type,
    parse_ar50_capabilities,
)

USER_AGENT = "NorgeWorldEngine-VegetationSourceCache/0.2 (+https://github.com/B4kke/Norge-World-Engine)"
SR16_VECTOR_METADATA_UUID = "27206b9e-4830-4f71-810d-d04c0dc32b59"
SR16_MAX_ARCHIVE_BYTES = 500_000_000
AR50_MAX_BYTES = 16 * 1024 * 1024


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def fetch_ar50_raw(feature_type: str, version: str, destination: Path) -> dict[str, Any]:
    min_e, min_n, max_e, max_n = BOUNDS_25832
    params = {
        "service": "WFS",
        "version": version,
        "request": "GetFeature",
        "typeName": feature_type,
        "srsName": "EPSG:25832",
        "bbox": f"{min_e},{min_n},{max_e},{max_n},EPSG:25832",
        "maxFeatures": "50",
    }
    url = f"{AR50_WFS_URL}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/gml+xml,text/xml,*/*;q=0.5"},
    )
    digest = hashlib.sha256()
    total = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=90) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > AR50_MAX_BYTES:
                raise RuntimeError(f"AR50_RESPONSE_TOO_LARGE>{AR50_MAX_BYTES}")
            handle.write(chunk)
            digest.update(chunk)
        return {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "bytes": total,
            "sha256": digest.hexdigest(),
        }


def select_sr16v_sosi_snapshot() -> tuple[dict[str, Any], dict[str, Any]]:
    atom_url = SR16_ATOM_URLS["vector"]
    raw, atom_http = fetch(atom_url, max_bytes=4 * 1024 * 1024)
    root = ET.fromstring(raw)
    matches: list[dict[str, Any]] = []
    for entry in root.iter():
        if local_name(entry.tag) != "entry":
            continue
        title = next((compact_text(child.text) for child in entry if local_name(child.tag) == "title"), None)
        updated = next((compact_text(child.text) for child in entry if local_name(child.tag) == "updated"), None)
        entry_text = (title or "").lower()
        if "nannestad" not in entry_text or "sone 32" not in entry_text:
            continue
        for child in entry:
            if local_name(child.tag) != "link":
                continue
            href = child.attrib.get("href")
            if not href:
                continue
            href_lower = href.lower()
            if "3238_25832_sr16_sosi" not in href_lower or not href_lower.endswith(".zip"):
                continue
            matches.append({
                "metadata_uuid": SR16_VECTOR_METADATA_UUID,
                "municipality_code": "3238",
                "municipality_name": "Nannestad",
                "projection": "EPSG:25832",
                "format": "SOSI",
                "entry_title": title,
                "entry_updated": updated,
                "href": href,
                "rel": child.attrib.get("rel"),
            })
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly one SR16V Nannestad/EPSG:25832 SOSI Atom snapshot, found {len(matches)}")
    return matches[0], atom_http


def materialize_sr16v(root: Path) -> dict[str, Any]:
    selection, atom_http = select_sr16v_sosi_snapshot()
    sr16_root = root / "sr16v"
    sr16_root.mkdir(parents=True, exist_ok=True)
    archive = sr16_root / "3238_25832_sr16_sosi.zip"
    download = stream_download(str(selection["href"]), archive, SR16_MAX_ARCHIVE_BYTES)
    extracted = sr16_root / "extracted"
    archive_info = safe_extract_zip(archive, extracted)
    source_files = sorted(extracted.rglob("*.sos")) + sorted(extracted.rglob("*.Sos")) + sorted(extracted.rglob("*.SOSI")) + sorted(extracted.rglob("*.sosi"))
    if len(source_files) != 1:
        raise RuntimeError(f"expected exactly one SR16V SOSI source file, found {len(source_files)}")
    source = source_files[0]
    return {
        "status": "PASS",
        "metadata_uuid": SR16_VECTOR_METADATA_UUID,
        "delivery": "NIBIO Atom Feed",
        "selection": selection,
        "atom_http": atom_http,
        "download": download,
        "archive": archive_info,
        "cache": {
            "archive_relative_path": str(archive.relative_to(root)),
            "source_relative_path": str(source.relative_to(root)),
            "source_format": "SOSI",
            "source_bytes": source.stat().st_size,
            "source_sha256": sha256_path(source),
        },
    }


def materialize_ar50(root: Path) -> dict[str, Any]:
    capabilities, names, version = parse_ar50_capabilities()
    if capabilities.get("status") != "PASS":
        raise RuntimeError(f"AR50 capabilities not usable: {capabilities!r}")
    feature_type = choose_ar50_feature_type(names)
    ar50_root = root / "ar50"
    a = fetch_ar50_raw(feature_type, version, ar50_root / "ar50-nannestad-a.gml")
    b = fetch_ar50_raw(feature_type, version, ar50_root / "ar50-nannestad-b.gml")
    return {
        "status": "PASS",
        "feature_type": feature_type,
        "wfs_version": version,
        "requested_crs": "EPSG:25832",
        "requested_bounds": list(BOUNDS_25832),
        "acquisitions": [
            {**a, "cache_relative_path": "ar50/ar50-nannestad-a.gml"},
            {**b, "cache_relative_path": "ar50/ar50-nannestad-b.gml"},
        ],
        "raw_hashes_equal": a["sha256"] == b["sha256"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    root = Path(args.work_dir).resolve()
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)

    report: dict[str, Any] = {
        "schema": "nwe.vegetation-source-cache-materialization/0.2",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "target_tile": {
            "id": "epsg25832_611000_6677000_1000m",
            "horizontal_crs": "EPSG:25832",
            "bounds": list(BOUNDS_25832),
        },
        "policy": {
            "manual_gate_only": True,
            "raw_files_committable": False,
            "raw_files_uploadable": False,
            "provider_order_created": False,
        },
        "sources": {},
    }

    failures = 0
    try:
        report["sources"]["sr16v"] = materialize_sr16v(root)
    except Exception as error:
        failures += 1
        report["sources"]["sr16v"] = {"status": "FAIL", "error": repr(error)}
    try:
        report["sources"]["ar50"] = materialize_ar50(root)
    except Exception as error:
        failures += 1
        report["sources"]["ar50"] = {"status": "FAIL", "error": repr(error)}

    report["status"] = "PASS" if failures == 0 else "FAIL"
    Path(args.output).write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
