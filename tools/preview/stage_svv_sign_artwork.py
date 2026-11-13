#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

TILE_ID = "epsg25832_611000_6677000_1000m"
FAMILY = "vikeplikt"
CODES = "202,206"
SOURCE_URL = "https://www.vegvesen.no/globalassets/fag/veg-og-gate/trafikkskilt-og-vegoppmerking/vikeplikt-jpg.zip?v=49939c"
EXPECTED_ARCHIVE_SHA256 = "4333750af2929d0e7e359457b837351fe8b51dc1638fe963804902dd514c1b28"
MANIFEST_SCHEMA = "nwe.svv-sign-artwork-runtime-manifest/0.1"


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_checked(args: list[str], *, cwd: Path) -> None:
    completed = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}")


def stage_sign_artwork(*, repo_root: Path, snapshot_root: Path) -> dict:
    preview_path = snapshot_root / "manifest.json"
    preview = json.loads(preview_path.read_text(encoding="utf-8"))
    if preview.get("schema") != "nwe.world-preview-manifest/0.1" or preview.get("tile", {}).get("id") != TILE_ID:
        raise RuntimeError("Preview manifest does not match sign-artwork tile")

    probe = repo_root / "tools" / "visual-data" / "probe_svv_sign_artwork.py"
    materializer = repo_root / "tools" / "visual-data" / "materialize_svv_sign_artwork.py"
    if not probe.is_file() or not materializer.is_file():
        raise RuntimeError("SVV sign-artwork tools missing")

    output_dir = snapshot_root / "realism" / "traffic-signs"
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="nwe-svv-sign-") as temp:
        temp_root = Path(temp)
        archive = temp_root / "vikeplikt.zip"
        probe_json = temp_root / "probe.json"
        run_checked([
            sys.executable, str(probe),
            "--family", FAMILY,
            "--output", str(probe_json),
            "--cache", str(archive),
        ], cwd=repo_root)
        probe_value = json.loads(probe_json.read_text(encoding="utf-8"))
        if probe_value.get("status") != "PASS" or probe_value.get("raw_sha256") != EXPECTED_ARCHIVE_SHA256:
            raise RuntimeError("SVV sign-artwork provider bytes drifted from admitted archive")
        run_checked([
            sys.executable, str(materializer),
            "--archive", str(archive),
            "--output-dir", str(output_dir),
            "--codes", CODES,
            "--family", FAMILY,
            "--source-url", SOURCE_URL,
        ], cwd=repo_root)

    manifest_path = output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != MANIFEST_SCHEMA or manifest.get("status") != "PASS":
        raise RuntimeError("SVV sign-artwork runtime manifest invalid")
    if manifest.get("source_archive_sha256") != EXPECTED_ARCHIVE_SHA256:
        raise RuntimeError("SVV sign-artwork manifest archive identity mismatch")
    expected_codes = ["202", "206"]
    if manifest.get("requested_sign_codes") != expected_codes:
        raise RuntimeError("SVV sign-artwork code set mismatch")
    for asset in manifest.get("assets") or []:
        path = output_dir / str(asset.get("runtime_filename") or "")
        if not path.is_file():
            raise RuntimeError("SVV sign-artwork materialized file missing")
        if path.stat().st_size != int(asset.get("byte_size") or -1) or sha256_path(path) != asset.get("sha256"):
            raise RuntimeError("SVV sign-artwork materialized byte identity mismatch")

    manifest_sha = sha256_path(manifest_path)
    manifest_size = manifest_path.stat().st_size
    layers = preview.setdefault("realism_layers", {})
    layers["sign_artwork"] = {
        "path": "./realism/traffic-signs/manifest.json",
        "artifact_sha256": manifest_sha,
        "artifact_byte_size": manifest_size,
        "schema": MANIFEST_SCHEMA,
        "source_archive_sha256": EXPECTED_ARCHIVE_SHA256,
        "truth_status": "provider-authored-SVV-NLOD-artwork-for-explicit-NVDB-sign-codes-202-and-206",
    }
    semantics = preview.setdefault("preview_semantics", {})
    semantics["sign_artwork"] = (
        "SVV provider-authored NLOD artwork for NVDB 202/206 is staged with archive + per-file SHA; "
        "other sign faces keep renderer facsimile fallback until their provider family passes the same gate"
    )
    attribution = preview.setdefault("attribution", [])
    notice = manifest.get("attribution")
    if isinstance(notice, str) and notice and notice not in attribution:
        attribution.append(notice)
    preview_path.write_text(json.dumps(preview, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (snapshot_root / "ATTRIBUTION.txt").write_text("\n".join(preview.get("attribution") or []) + "\n", encoding="utf-8")

    total_bytes = sum(path.stat().st_size for path in snapshot_root.rglob("*") if path.is_file())
    if total_bytes > 35 * 1024 * 1024:
        raise RuntimeError(f"Preview snapshot with sign artwork unexpectedly large: {total_bytes} bytes")
    return {
        "schema": "nwe.preview-svv-sign-artwork-stage/0.1",
        "status": "PASS",
        "manifest_sha256": manifest_sha,
        "manifest_byte_size": manifest_size,
        "source_archive_sha256": EXPECTED_ARCHIVE_SHA256,
        "asset_count": len(manifest.get("assets") or []),
        "requested_sign_codes": manifest.get("requested_sign_codes"),
        "snapshot_byte_size": total_bytes,
    }


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot-root", type=Path, required=True)
    args = parser.parse_args()
    result = stage_sign_artwork(repo_root=repo_root, snapshot_root=args.snapshot_root.resolve())
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
