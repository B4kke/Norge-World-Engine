#!/usr/bin/env python3
"""Materialize one bounded Nannestad vegetation source cache for offline normalization.

This is a manual/source-gate tool. It creates one public NIBIO SR16V GML order for
Nannestad and performs two bounded AR50 WFS reads for the accepted 1 km tile.
Raw provider bytes stay in --work-dir and must never be committed or uploaded as CI artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from materialize_visual_source_samples import first_file, safe_extract_zip, stream_download
from order_visual_source_samples import TARGETS, order_target
from probe_vegetation_real_sample import (
    AR50_WFS_URL,
    BOUNDS_25832,
    choose_ar50_feature_type,
    parse_ar50_capabilities,
)

USER_AGENT = "NorgeWorldEngine-VegetationSourceCache/0.1 (+https://github.com/B4kke/Norge-World-Engine)"
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


def validate_sr16_selection(selection: dict[str, Any]) -> None:
    if str(selection.get("metadataUuid")) != SR16_VECTOR_METADATA_UUID:
        raise RuntimeError(f"unexpected SR16 metadata UUID in provider selection: {selection!r}")
    areas = selection.get("areas") or []
    projections = selection.get("projections") or []
    formats = selection.get("formats") or []
    if len(areas) != 1 or str(areas[0].get("code")) != "3238":
        raise RuntimeError(f"SR16 selection is not exactly Nannestad/3238: {selection!r}")
    if len(projections) != 1 or str(projections[0].get("code")) != "25832":
        raise RuntimeError(f"SR16 selection is not exactly EPSG:25832: {selection!r}")
    if len(formats) != 1 or str(formats[0].get("name", "")).lower() != "gml":
        raise RuntimeError(f"SR16 selection is not exactly GML: {selection!r}")


def materialize_sr16v(root: Path) -> dict[str, Any]:
    config = dict(TARGETS["sr16_vector"])
    # Prefer GML for the normalization gate so generic GDAL/OGR can parse it without
    # relying on an optional SOSI/FYBA driver in the hosted runner image.
    config["format"] = "GML"
    order = order_target("sr16_vector", config)
    validate_sr16_selection(order["selection"])
    provider_file = first_file(order["receipt"])

    sr16_root = root / "sr16v"
    sr16_root.mkdir(parents=True, exist_ok=True)
    archive = sr16_root / str(provider_file.get("name") or "sr16v-nannestad.zip")
    download = stream_download(str(provider_file["downloadUrl"]), archive, SR16_MAX_ARCHIVE_BYTES)
    extracted = sr16_root / "extracted"
    archive_info = safe_extract_zip(archive, extracted)
    gml_files = sorted(extracted.rglob("*.gml")) + sorted(extracted.rglob("*.GML"))
    if len(gml_files) != 1:
        raise RuntimeError(f"expected exactly one SR16V GML source file, found {len(gml_files)}")
    gml = gml_files[0]
    return {
        "status": "PASS",
        "metadata_uuid": SR16_VECTOR_METADATA_UUID,
        "selection": order["selection"],
        "provider_file": {
            "name": provider_file.get("name"),
            "status": provider_file.get("status"),
            "format": provider_file.get("format"),
            "projection": provider_file.get("projection"),
        },
        "download": download,
        "archive": archive_info,
        "cache": {
            "archive_relative_path": str(archive.relative_to(root)),
            "gml_relative_path": str(gml.relative_to(root)),
            "gml_bytes": gml.stat().st_size,
            "gml_sha256": sha256_path(gml),
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
        "schema": "nwe.vegetation-source-cache-materialization/0.1",
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
            "sr16_order_creates_email_notification": False,
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
