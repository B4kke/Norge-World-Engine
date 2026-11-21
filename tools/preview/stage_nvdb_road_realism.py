#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

SCHEMA = "nwe.road-realism-artifact/0.1-candidate"
ALGORITHM = "nvdb-838-primary-583-nonoverlap-fallback-241-surface-v0.1"
TILE_ID = "epsg25832_611000_6677000_1000m"


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stage_road_realism(*, repo_root: Path, snapshot_root: Path) -> dict:
    compiler = repo_root / "tools" / "geo" / "compile_nvdb_road_realism.py"
    if not compiler.is_file():
        raise RuntimeError(f"road realism compiler missing: {compiler}")
    realism_dir = snapshot_root / "realism"
    realism_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = realism_dir / "road-realism.json"
    verification_path = realism_dir / "road-realism-verification.json"
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
            "NVDB road realism compilation failed: "
            + (completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}")
        )
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    verification = json.loads(verification_path.read_text(encoding="utf-8"))
    if artifact.get("schema") != SCHEMA or artifact.get("tile_id") != TILE_ID:
        raise RuntimeError("road realism artifact identity mismatch")
    if artifact.get("horizontal_crs") != "EPSG:25832" or artifact.get("compiler_algorithm") != ALGORITHM:
        raise RuntimeError("road realism world/compiler contract mismatch")
    if verification.get("status") != "PASS":
        raise RuntimeError("road realism verification did not pass")
    actual_sha = sha256_path(artifact_path)
    actual_size = artifact_path.stat().st_size
    if actual_sha != verification.get("artifact_sha256") or actual_size != verification.get("artifact_byte_size"):
        raise RuntimeError("road realism artifact byte identity mismatch")
    if int(artifact.get("stats", {}).get("width_feature_part_count") or 0) < 1:
        raise RuntimeError("road realism contains no source-backed widths")

    preview_path = snapshot_root / "manifest.json"
    preview = json.loads(preview_path.read_text(encoding="utf-8"))
    if preview.get("schema") != "nwe.world-preview-manifest/0.1" or preview.get("tile", {}).get("id") != TILE_ID:
        raise RuntimeError("Preview manifest does not match road realism tile")
    layers = preview.setdefault("realism_layers", {})
    layers["road_realism"] = {
        "path": "./realism/road-realism.json",
        "artifact_sha256": actual_sha,
        "artifact_byte_size": actual_size,
        "schema": SCHEMA,
        "compiler_algorithm": ALGORITHM,
        "truth_status": "source-backed-NVDB-width-and-surface-candidate-with-explicit-fallback-elsewhere",
    }
    semantics = preview.setdefault("preview_semantics", {})
    semantics["road_width"] = "NVDB type 838 Dekkebredde primary; type 583 non-overlap fallback; accepted centerline 3.2m renderer fallback elsewhere"
    semantics["road_surface"] = "NVDB type 241 Massetype where available; material rendering remains asphalt PBR for admitted current sample"
    attribution = preview.setdefault("attribution", [])
    notice = artifact.get("attribution")
    if isinstance(notice, str) and notice and notice not in attribution:
        attribution.append(notice)
    preview_path.write_text(json.dumps(preview, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (snapshot_root / "ATTRIBUTION.txt").write_text("\n".join(preview.get("attribution") or []) + "\n", encoding="utf-8")

    total_bytes = sum(path.stat().st_size for path in snapshot_root.rglob("*") if path.is_file())
    if total_bytes > 34 * 1024 * 1024:
        raise RuntimeError(f"Preview snapshot with road realism unexpectedly large: {total_bytes} bytes")
    return {
        "schema": "nwe.preview-road-realism-stage/0.1",
        "status": "PASS",
        "artifact_sha256": actual_sha,
        "artifact_byte_size": actual_size,
        "width_feature_part_count": artifact["stats"]["width_feature_part_count"],
        "width_range_m": artifact["stats"]["width_range_m"],
        "surface_material_counts": artifact["stats"]["surface_material_counts"],
        "snapshot_byte_size": total_bytes,
    }


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot-root", type=Path, required=True)
    args = parser.parse_args()
    result = stage_road_realism(repo_root=repo_root, snapshot_root=args.snapshot_root.resolve())
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
