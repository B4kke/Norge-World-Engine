#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

SCHEMA = "nwe.nvdb-street-detail-artifact/0.1-candidate"
ALGORITHM = "nvdb-v4-explicit-geometry-street-detail-v0.1"
TILE_ID = "epsg25832_611000_6677000_1000m"


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stage_street_detail(*, repo_root: Path, snapshot_root: Path) -> dict:
    compiler = repo_root / "tools" / "geo" / "compile_nvdb_street_detail.py"
    if not compiler.is_file():
        raise RuntimeError(f"street detail compiler missing: {compiler}")
    realism_dir = snapshot_root / "realism"
    realism_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = realism_dir / "street-detail.json"
    verification_path = realism_dir / "street-detail-verification.json"
    completed = subprocess.run(
        [
            sys.executable,
            str(compiler),
            "--output",
            str(artifact_path),
            "--verification",
            str(verification_path),
        ],
        cwd=repo_root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "NVDB street detail compilation failed: "
            + (completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}")
        )
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    verification = json.loads(verification_path.read_text(encoding="utf-8"))
    if artifact.get("schema") != SCHEMA or artifact.get("tile_id") != TILE_ID:
        raise RuntimeError("street detail artifact identity mismatch")
    if artifact.get("horizontal_crs") != "EPSG:25832" or artifact.get("compiler_algorithm") != ALGORITHM:
        raise RuntimeError("street detail world/compiler contract mismatch")
    if verification.get("status") != "PASS":
        raise RuntimeError("street detail verification did not pass")
    actual_sha = sha256_path(artifact_path)
    actual_size = artifact_path.stat().st_size
    if actual_sha != verification.get("artifact_sha256") or actual_size != verification.get("artifact_byte_size"):
        raise RuntimeError("street detail artifact byte identity mismatch")
    if int(artifact.get("stats", {}).get("feature_part_count") or 0) < 1:
        raise RuntimeError("street detail artifact contains no explicit source geometry")

    preview_path = snapshot_root / "manifest.json"
    preview = json.loads(preview_path.read_text(encoding="utf-8"))
    if preview.get("schema") != "nwe.world-preview-manifest/0.1" or preview.get("tile", {}).get("id") != TILE_ID:
        raise RuntimeError("Preview manifest does not match street detail tile")
    layers = preview.setdefault("realism_layers", {})
    layers["street_detail"] = {
        "path": "./realism/street-detail.json",
        "artifact_sha256": actual_sha,
        "artifact_byte_size": actual_size,
        "schema": SCHEMA,
        "compiler_algorithm": ALGORITHM,
        "truth_status": "source-backed-NVDB-explicit-point-and-line-geometry-with-renderer-authored-appearance",
    }
    semantics = preview.setdefault("preview_semantics", {})
    semantics["street_detail"] = (
        "NVDB explicit geometry for markings/sign points/lighting/ditches/kerbs/sidewalks where present; "
        "renderer appearance and missing dimensions remain presentation-only"
    )
    attribution = preview.setdefault("attribution", [])
    notice = artifact.get("attribution")
    if isinstance(notice, str) and notice and notice not in attribution:
        attribution.append(notice)
    preview_path.write_text(json.dumps(preview, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (snapshot_root / "ATTRIBUTION.txt").write_text("\n".join(preview.get("attribution") or []) + "\n", encoding="utf-8")

    total_bytes = sum(path.stat().st_size for path in snapshot_root.rglob("*") if path.is_file())
    if total_bytes > 35 * 1024 * 1024:
        raise RuntimeError(f"Preview snapshot with street detail unexpectedly large: {total_bytes} bytes")
    return {
        "schema": "nwe.preview-street-detail-stage/0.1",
        "status": "PASS",
        "artifact_sha256": actual_sha,
        "artifact_byte_size": actual_size,
        "feature_part_count": artifact["stats"]["feature_part_count"],
        "feature_parts_by_type_id": artifact["stats"]["feature_parts_by_type_id"],
        "snapshot_byte_size": total_bytes,
    }


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot-root", type=Path, required=True)
    args = parser.parse_args()
    result = stage_street_detail(repo_root=repo_root, snapshot_root=args.snapshot_root.resolve())
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
