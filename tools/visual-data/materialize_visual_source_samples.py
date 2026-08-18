#!/usr/bin/env python3
"""Materialize bounded Skyfritt/SR16 source samples for compiler inspection.

Raw downloads and extracted source files stay in the supplied work directory and are never
committed. The JSON report is intentionally small/committable evidence. Provider orders are
created through the same validated public download contracts as order_visual_source_samples.py.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from order_visual_source_samples import TARGETS, order_target

NANNESTAD_BOUNDS = (611000.0, 6677000.0, 612000.0, 6678000.0)
MAX_ARCHIVE_BYTES = {
    "skyfritt_2025": 1_500_000_000,
    "sr16_vector": 500_000_000,
}
USER_AGENT = "NorgeWorldEngine-VisualMaterializer/0.1 (+https://github.com/B4kke/Norge-World-Engine)"


def first_file(receipt: Any) -> dict[str, Any]:
    files = receipt.get("files") if isinstance(receipt, dict) else None
    if not isinstance(files, list) or len(files) != 1 or not isinstance(files[0], dict):
        raise RuntimeError(f"expected exactly one provider file, got {files!r}")
    value = files[0]
    if value.get("status") != "ReadyForDownload" or not value.get("downloadUrl"):
        raise RuntimeError(f"provider file not ready: {value!r}")
    return value


def stream_download(url: str, destination: Path, max_bytes: int) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream"})
    digest = hashlib.sha256()
    total = 0
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as handle:
        declared = response.headers.get("Content-Length")
        if declared and int(declared) > max_bytes:
            raise RuntimeError(f"declared archive size {declared} exceeds max {max_bytes}")
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError(f"stream exceeded archive limit {max_bytes}")
            handle.write(chunk)
            digest.update(chunk)
        return {
            "url": response.geturl(),
            "declared_bytes": int(declared) if declared else None,
            "bytes": total,
            "sha256": digest.hexdigest(),
            "content_type": response.headers.get("Content-Type"),
        }


def safe_extract_zip(archive: Path, destination: Path) -> dict[str, Any]:
    destination.mkdir(parents=True, exist_ok=True)
    members = []
    with zipfile.ZipFile(archive) as handle:
        infos = handle.infolist()
        total_uncompressed = sum(info.file_size for info in infos)
        for info in infos:
            normalized = Path(info.filename)
            if normalized.is_absolute() or ".." in normalized.parts:
                raise RuntimeError(f"unsafe zip member: {info.filename}")
            target = (destination / normalized).resolve()
            if destination.resolve() not in target.parents and target != destination.resolve():
                raise RuntimeError(f"zip member escaped destination: {info.filename}")
            members.append({"name": info.filename, "bytes": info.file_size, "compressed_bytes": info.compress_size})
        handle.extractall(destination)
    return {
        "member_count": len(members),
        "uncompressed_bytes": total_uncompressed,
        "members": members[:40],
        "members_truncated": max(0, len(members) - 40),
    }


def inspect_skyfritt(extracted: Path) -> dict[str, Any]:
    try:
        import numpy as np
        import rasterio
        from rasterio.windows import from_bounds
    except Exception as error:
        return {"status": "BLOCKED", "reason": f"rasterio unavailable: {error!r}"}

    tiffs = sorted([*extracted.rglob("*.tif"), *extracted.rglob("*.tiff")])
    if len(tiffs) != 1:
        return {"status": "BLOCKED", "reason": f"expected one TIFF, found {len(tiffs)}", "paths": [str(p.relative_to(extracted)) for p in tiffs[:20]]}
    path = tiffs[0]
    with rasterio.open(path) as dataset:
        dataset_crs = dataset.crs.to_string() if dataset.crs else None
        window = from_bounds(*NANNESTAD_BOUNDS, transform=dataset.transform)
        window = window.round_offsets().round_lengths()
        sample = dataset.read(window=window, boundless=True)
        stats = []
        for band in sample:
            valid = band[np.isfinite(band)]
            if valid.size:
                stats.append({
                    "min": float(valid.min()),
                    "max": float(valid.max()),
                    "p02": float(np.percentile(valid, 2)),
                    "p50": float(np.percentile(valid, 50)),
                    "p98": float(np.percentile(valid, 98)),
                })
            else:
                stats.append(None)
        return {
            "status": "PASS" if dataset_crs == "EPSG:25832" else "CRS_MISMATCH",
            "source_file": str(path.relative_to(extracted)),
            "crs": dataset_crs,
            "width": dataset.width,
            "height": dataset.height,
            "count": dataset.count,
            "dtypes": list(dataset.dtypes),
            "bounds": [dataset.bounds.left, dataset.bounds.bottom, dataset.bounds.right, dataset.bounds.top],
            "pixel_size": [dataset.transform.a, abs(dataset.transform.e)],
            "nannestad_window": [int(window.col_off), int(window.row_off), int(window.width), int(window.height)],
            "nannestad_sample_shape": list(sample.shape),
            "nannestad_band_stats": stats,
        }


def run_capture(command: list[str], *, timeout: int = 120) -> tuple[int, str]:
    try:
        result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)
        return result.returncode, result.stdout[-30000:]
    except Exception as error:
        return 127, repr(error)


def inspect_sr16(extracted: Path, workdir: Path) -> dict[str, Any]:
    sosi_files = sorted([*extracted.rglob("*.sos"), *extracted.rglob("*.SOS")])
    if not sosi_files:
        return {"status": "BLOCKED", "reason": "no SOSI file found"}
    source = sosi_files[0]
    ogrinfo = shutil.which("ogrinfo")
    ogr2ogr = shutil.which("ogr2ogr")
    if not ogrinfo or not ogr2ogr:
        return {"status": "BLOCKED", "reason": "GDAL/OGR command line unavailable", "source_file": str(source.relative_to(extracted))}

    format_code, formats = run_capture([ogrinfo, "--formats"])
    has_sosi = format_code == 0 and "SOSI" in formats.upper()
    if not has_sosi:
        return {"status": "BLOCKED", "reason": "GDAL/OGR build lacks SOSI driver", "source_file": str(source.relative_to(extracted))}

    info_code, info = run_capture([ogrinfo, "-ro", "-so", "-al", str(source)])
    clipped = workdir / "sr16-nannestad-1km.geojson"
    clip_code, clip_output = run_capture([
        ogr2ogr,
        "-f", "GeoJSON",
        str(clipped),
        str(source),
        "-spat", *(str(value) for value in NANNESTAD_BOUNDS),
        "-t_srs", "EPSG:25832",
    ], timeout=180)
    summary: dict[str, Any] = {
        "source_file": str(source.relative_to(extracted)),
        "sosi_driver": True,
        "ogrinfo_exit": info_code,
        "ogrinfo_tail": info,
        "clip_exit": clip_code,
        "clip_tail": clip_output,
    }
    if clip_code == 0 and clipped.exists():
        raw = clipped.read_bytes()
        value = json.loads(raw.decode("utf-8"))
        features = value.get("features", []) if isinstance(value, dict) else []
        field_names = sorted({str(key) for feature in features if isinstance(feature, dict) for key in (feature.get("properties") or {}).keys()})
        geometry_types = sorted({str((feature.get("geometry") or {}).get("type")) for feature in features if isinstance(feature, dict)})
        summary.update({
            "status": "PASS",
            "nannestad_feature_count": len(features),
            "field_names": field_names,
            "geometry_types": geometry_types,
            "clipped_geojson_bytes": len(raw),
            "clipped_geojson_sha256": hashlib.sha256(raw).hexdigest(),
        })
    else:
        summary["status"] = "BLOCKED"
    return summary


def materialize(name: str, config: dict[str, str], root: Path) -> dict[str, Any]:
    order = order_target(name, config)
    provider_file = first_file(order["receipt"])
    source_root = root / name
    source_root.mkdir(parents=True, exist_ok=True)
    archive = source_root / str(provider_file.get("name") or f"{name}.zip")
    download = stream_download(str(provider_file["downloadUrl"]), archive, MAX_ARCHIVE_BYTES[name])
    extracted = source_root / "extracted"
    archive_info = safe_extract_zip(archive, extracted)
    inspection = inspect_skyfritt(extracted) if name == "skyfritt_2025" else inspect_sr16(extracted, source_root)
    return {
        "status": "PASS" if inspection.get("status") == "PASS" else "INCOMPLETE",
        "selection": order["selection"],
        "provider_file": {
            "name": provider_file.get("name"),
            "status": provider_file.get("status"),
            "format": provider_file.get("format"),
            "projection": provider_file.get("projection"),
        },
        "download": download,
        "archive": archive_info,
        "inspection": inspection,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.work_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "schema": "nwe.visual-source-materialization/0.1",
        "raw_files_committable": False,
        "target_tile": {"id": "epsg25832_611000_6677000_1000m", "bounds": list(NANNESTAD_BOUNDS), "crs": "EPSG:25832"},
        "datasets": {},
    }
    failures = 0
    for name, config in TARGETS.items():
        try:
            report["datasets"][name] = materialize(name, config, root)
            if report["datasets"][name]["status"] != "PASS":
                failures += 1
        except Exception as error:
            failures += 1
            report["datasets"][name] = {"status": "FAIL", "error": repr(error)}
    report["status"] = "PASS" if failures == 0 else "INCOMPLETE"
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
