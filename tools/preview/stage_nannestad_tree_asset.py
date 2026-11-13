#!/usr/bin/env python3
"""Add one SHA-verified, bounded CC0 visual tree asset to a staging snapshot.

This is PREPROCESSING. The browser loads only the staged, content-addressed
derivative. The original authoring GLB never enters the browser and isn't
committed. If the provider moves/changes the source, fail instead of guessing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def stage_tree(*, repo_root: Path, snapshot_root: Path) -> dict:
    manifest_path = snapshot_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (manifest.get("tile") or {}).get("id") != "epsg25832_611000_6677000_1000m":
        raise RuntimeError("TREE_STAGE_TILE_MISMATCH")
    out = snapshot_root / "realism" / "trees"
    out.mkdir(parents=True, exist_ok=True)
    output_glb = out / "conifer-light-merged.glb"
    output_report = out / "conifer-light-report.json"
    script = repo_root / "tools" / "visual-data" / "build_nannestad_tree_lod.py"
    result = subprocess.run([
        sys.executable, str(script), "--output-glb", str(output_glb),
        "--output-report", str(output_report),
    ], cwd=repo_root, text=True, capture_output=True, check=False, timeout=120)
    if result.returncode:
        raise RuntimeError("TREE_STAGE_BAKE_FAILED: " + (result.stderr or result.stdout)[-1300:])
    report_bytes = output_report.read_bytes()
    report = json.loads(report_bytes.decode("utf-8"))
    content = output_glb.read_bytes()
    expected = report["runtime"]
    digest = hashlib.sha256(content).hexdigest()
    if report["status"] != "PASS" or expected["sha256"] != digest or len(content) != expected["byte_size"]:
        raise RuntimeError("TREE_STAGE_RUNTIME_SHA_MISMATCH")
    if not (100 <= expected["triangles"] <= 12000 and expected["mesh_count"] == 1):
        raise RuntimeError("TREE_STAGE_TRIANGLE_OR_MESH_BUDGET")
    if report.get("runtime_provider_requests") != 0:
        raise RuntimeError("TREE_STAGE_RUNTIME_PROVIDER_REQUEST")
    if report["source"]["license"] != "CC0-1.0":
        raise RuntimeError("TREE_STAGE_LICENSE_NOT_ADMITTED")
    if "tree_asset" in manifest.setdefault("realism_layers", {}):
        raise RuntimeError("TREE_STAGE_ALREADY_PRESENT")
    manifest["realism_layers"]["tree_asset"] = {
        "schema": report["schema"],
        "path": "./realism/trees/conifer-light-merged.glb",
        "report_path": "./realism/trees/conifer-light-report.json",
        "sha256": digest,
        "byte_size": len(content),
        "report_sha256": hashlib.sha256(report_bytes).hexdigest(),
        "source_sha256": report["source"]["sha256"],
        "license": "CC0-1.0",
        "max_near_instances": expected["max_near_instances"],
        "near_radius_m": expected["near_radius_m"],
        "nominal_height_m": expected["nominal_height_m"],
        "triangles": expected["triangles"],
        "truth_status": "presentation-only-generic-conifer-not-an-observed-tree",
    }
    manifest.setdefault("preview_semantics", {})["tree_asset"] = (
        "source-SHA-verified offline CC0 tree derivative, used only for bounded near-field "
        "SR16V representative presentation; not individual-tree source truth"
    )
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return {"status": "PASS", "sha256": digest, "bytes": len(content),
            "triangles": expected["triangles"], "original_meshes": report["source"]["mesh_count"],
            "draw_call_meshes": expected["mesh_count"], "license": "CC0-1.0"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot-root", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(stage_tree(repo_root=Path(__file__).resolve().parents[2],
                                snapshot_root=args.snapshot_root.resolve()), indent=2))


if __name__ == "__main__":
    main()
