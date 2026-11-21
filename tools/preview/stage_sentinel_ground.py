#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

TILE_ID = "epsg25832_611000_6677000_1000m"
TARGET_BOUNDS = [611000.0, 6677000.0, 612000.0, 6678000.0]
SEARCH_START = "2026-05-01"
SEARCH_END = "2026-09-30"
MAX_CLOUD_PERCENT = 20.0
GROUND_SCHEMA = "nwe.private-ground-imagery/0.1"


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stage_sentinel_ground(*, repo_root: Path, snapshot_root: Path, refresh: bool = True) -> dict:
    fetch_tool = repo_root / "apps" / "unreal-runtime" / "Tools" / "fetch_sentinel_ground_imagery.py"
    if not fetch_tool.is_file():
        raise RuntimeError(f"Sentinel authoring tool missing: {fetch_tool}")

    command = [
        sys.executable,
        str(fetch_tool),
        "--start-date",
        SEARCH_START,
        "--end-date",
        SEARCH_END,
        "--max-cloud-percent",
        str(MAX_CLOUD_PERCENT),
    ]
    if refresh:
        command.append("--refresh")
    completed = subprocess.run(
        command,
        cwd=repo_root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "Sentinel ground acquisition failed: "
            + (completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}")
        )

    authoring_root = repo_root / "apps" / "unreal-runtime" / "Saved" / "NWE" / "PrivateVisual" / "ground"
    source_manifest_path = authoring_root / "ground-imagery.json"
    if not source_manifest_path.is_file():
        raise RuntimeError("Sentinel authoring completed without ground-imagery.json")
    ground = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    if ground.get("schema") != GROUND_SCHEMA:
        raise RuntimeError(f"unexpected ground imagery schema: {ground.get('schema')!r}")
    if ground.get("tile_id") != TILE_ID or ground.get("horizontal_crs") != "EPSG:25832":
        raise RuntimeError("ground imagery tile/CRS mismatch")
    if list(ground.get("bounds") or []) != TARGET_BOUNDS:
        raise RuntimeError("ground imagery bounds mismatch")
    source = ground.get("source") or {}
    texture = ground.get("texture") or {}
    if source.get("provider") != "Copernicus Sentinel-2 via Earth Search":
        raise RuntimeError(f"unexpected ground imagery provider: {source.get('provider')!r}")
    if source.get("redistribution") != "allowed-by-license":
        raise RuntimeError("ground imagery is not admitted for public runtime redistribution")
    if source.get("search_window") != {"start_date": SEARCH_START, "end_date": SEARCH_END}:
        raise RuntimeError("ground imagery selection window drifted")
    if ground.get("transform", {}).get("geometry_displacement") is not False:
        raise RuntimeError("ground imagery must never displace accepted DTM geometry")
    if ground.get("transform", {}).get("sentinel_ground_truth") != "presentation-only-10m-satellite-ground-color-not-orthophoto":
        raise RuntimeError("ground imagery truth label missing")

    texture_name = str(texture.get("path") or "")
    source_texture_path = authoring_root / texture_name
    if not source_texture_path.is_file():
        raise RuntimeError(f"ground imagery texture missing: {source_texture_path}")
    actual_sha = sha256_path(source_texture_path)
    actual_size = source_texture_path.stat().st_size
    if actual_sha != texture.get("sha256") or actual_size != int(texture.get("byte_size") or -1):
        raise RuntimeError("ground imagery texture identity mismatch")

    output_root = snapshot_root / "ground"
    output_root.mkdir(parents=True, exist_ok=True)
    target_texture_path = output_root / texture_name
    target_manifest_path = output_root / "ground-imagery.json"
    shutil.copyfile(source_texture_path, target_texture_path)
    shutil.copyfile(source_manifest_path, target_manifest_path)

    preview_manifest_path = snapshot_root / "manifest.json"
    preview = json.loads(preview_manifest_path.read_text(encoding="utf-8"))
    if preview.get("schema") != "nwe.world-preview-manifest/0.1" or preview.get("tile", {}).get("id") != TILE_ID:
        raise RuntimeError("Preview manifest does not match Sentinel ground tile")
    preview["ground_imagery"] = {
        "manifest": "./ground/ground-imagery.json",
        "texture": f"./ground/{texture_name}",
        "texture_sha256": actual_sha,
        "texture_byte_size": actual_size,
        "provider": source["provider"],
        "stac_collection": source.get("stac_collection"),
        "stac_item_id": source.get("stac_item_id"),
        "stac_datetime": source.get("stac_datetime"),
        "eo_cloud_cover_percent": source.get("eo_cloud_cover_percent"),
        "truth_status": "presentation-only-10m-satellite-ground-color-not-orthophoto",
    }
    semantics = preview.setdefault("preview_semantics", {})
    semantics["ground_color"] = "Sentinel-2-10m-source-backed-macro-color-only; PBR microdetail remains generic; no DTM displacement"
    notice = str(source.get("copernicus_notice") or "").strip()
    if notice:
        attribution = preview.setdefault("attribution", [])
        if notice not in attribution:
            attribution.append(notice)
    preview_manifest_path.write_text(json.dumps(preview, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    attribution_path = snapshot_root / "ATTRIBUTION.txt"
    attribution_path.write_text("\n".join(preview.get("attribution") or []) + "\n", encoding="utf-8")

    total_bytes = sum(path.stat().st_size for path in snapshot_root.rglob("*") if path.is_file())
    if total_bytes > 32 * 1024 * 1024:
        raise RuntimeError(f"Preview snapshot with ground color unexpectedly large: {total_bytes} bytes")

    return {
        "schema": "nwe.preview-sentinel-ground-stage/0.1",
        "status": "PASS",
        "tile_id": TILE_ID,
        "search_window": {"start_date": SEARCH_START, "end_date": SEARCH_END},
        "max_cloud_percent": MAX_CLOUD_PERCENT,
        "stac_item_id": source.get("stac_item_id"),
        "stac_datetime": source.get("stac_datetime"),
        "eo_cloud_cover_percent": source.get("eo_cloud_cover_percent"),
        "texture_sha256": actual_sha,
        "texture_byte_size": actual_size,
        "snapshot_byte_size": total_bytes,
        "truth": "presentation-only-10m-satellite-ground-color-not-orthophoto",
    }


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot-root", type=Path, required=True)
    parser.add_argument("--no-refresh", action="store_true")
    args = parser.parse_args()
    result = stage_sentinel_ground(
        repo_root=repo_root,
        snapshot_root=args.snapshot_root.resolve(),
        refresh=not args.no_refresh,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
