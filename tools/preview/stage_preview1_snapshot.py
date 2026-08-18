from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

CACHE_PREFIX = "cache://compiled/"
RAW_MARKERS = ("kartverket", "geonorge", "vegvesen", "nvdb", "overpass", "openstreetmap")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def compiled_relative(bundle: dict) -> Path:
    reference = bundle.get("artifact_ref", {}).get("transport", {}).get("reference")
    if not isinstance(reference, str) or not reference.startswith(CACHE_PREFIX):
        raise RuntimeError(f"compiled transport must use {CACHE_PREFIX}: {reference!r}")
    lowered = reference.lower()
    if any(marker in lowered for marker in RAW_MARKERS):
        raise RuntimeError(f"raw-source marker found in compiled transport: {reference}")
    relative = reference[len(CACHE_PREFIX) :]
    if not relative or relative.startswith("/") or ".." in Path(relative).parts:
        raise RuntimeError(f"unsafe compiled relative path: {relative!r}")
    return Path(relative)


def copy_runtime_pair(*, bundle_path: Path, artifact_path: Path, output: Path, bundle_name: str) -> dict:
    bundle = read_json(bundle_path)
    artifact_ref = bundle.get("artifact_ref") or {}
    expected_sha = artifact_ref.get("sha256")
    expected_size = artifact_ref.get("byte_size")
    actual_sha = sha256_file(artifact_path)
    actual_size = artifact_path.stat().st_size
    if actual_sha != expected_sha:
        raise RuntimeError(f"{bundle_name}: artifact SHA mismatch {actual_sha} != {expected_sha}")
    if actual_size != expected_size:
        raise RuntimeError(f"{bundle_name}: artifact size mismatch {actual_size} != {expected_size}")

    output.mkdir(parents=True, exist_ok=True)
    bundle_target = output / bundle_name
    shutil.copyfile(bundle_path, bundle_target)
    compiled_target = output / "compiled" / compiled_relative(bundle)
    compiled_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(artifact_path, compiled_target)
    return {
        "bundle": f"./{bundle_name}",
        "artifact_sha256": actual_sha,
        "artifact_byte_size": actual_size,
        "artifact_role": artifact_ref.get("artifact_role"),
        "media_type": artifact_ref.get("media_type"),
        "compiled_path": f"./compiled/{compiled_relative(bundle).as_posix()}",
    }


def compile_vectors(cache_root: Path) -> dict:
    completed = subprocess.run(
        ["nwe-compile-vectors", "--cache-root", str(cache_root), "--refresh"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    report = json.loads(completed.stdout)
    if report.get("status") != "PASS":
        raise RuntimeError("vector compiler did not report PASS")
    return report


def build_terrain(cache_root: Path, working_dir: Path) -> tuple[Path, Path, dict]:
    from nwe_compiler.acquisition import TILE_BOUNDS
    from nwe_compiler.raster import warp_dtm_to_canonical_grid
    from nwe_compiler.terrain_acquisition import acquire_dtm1
    from nwe_compiler.terrain_artifacts import compile_terrain_artifact, persist_terrain_artifact

    working_dir.mkdir(parents=True, exist_ok=True)
    acquired = acquire_dtm1(cache_root, refresh=True, timeout=600)
    canonical = working_dir / "nannestad-dtm1-epsg25832.tif"
    warp_dtm_to_canonical_grid(acquired.raw_path, canonical, TILE_BOUNDS)
    compiled = compile_terrain_artifact(acquired, canonical)
    persisted = persist_terrain_artifact(compiled, canonical, cache_root)
    return Path(persisted.bundle_path), Path(persisted.artifact_path), compiled.artifact_header


def stage_snapshot(*, terrain_proof_dir: Path | None, cache_root: Path, output: Path, commit_sha: str | None) -> dict:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    if terrain_proof_dir is not None:
        terrain_report = read_json(terrain_proof_dir / "dtm1-realdata-proof.json")
        terrain_info = terrain_report["compiled_artifact"]
        terrain_bundle_path = terrain_proof_dir / terrain_info["bundle_file"]
        terrain_artifact_path = terrain_proof_dir / terrain_info["artifact_file"]
        terrain_header = terrain_info["header"]
    else:
        terrain_bundle_path, terrain_artifact_path, terrain_header = build_terrain(cache_root, output.parent / "terrain-work")
    terrain = copy_runtime_pair(
        bundle_path=terrain_bundle_path,
        artifact_path=terrain_artifact_path,
        output=output,
        bundle_name="terrain.bundle.json",
    )

    vector_report = compile_vectors(cache_root)
    vector_by_source = {item["source"]: item for item in vector_report["results"]}
    if set(vector_by_source) != {"roads", "buildings"}:
        raise RuntimeError(f"unexpected vector sources: {sorted(vector_by_source)}")

    layers: dict[str, dict] = {}
    for source, bundle_name in (("roads", "roads.bundle.json"), ("buildings", "buildings.bundle.json")):
        item = vector_by_source[source]
        layer = copy_runtime_pair(
            bundle_path=Path(item["bundle_path"]),
            artifact_path=Path(item["artifact_path"]),
            output=output,
            bundle_name=bundle_name,
        )
        layer.update(
            {
                "raw_sha256": item["raw_sha256"],
                "raw_object_count": item["raw_object_count"],
                "source_selected_count": item["source_selected_count"],
                "normalized_count": item["normalized_count"],
                "compiled_count": item["compiled_count"],
            }
        )
        layers[source] = layer

    header = terrain_header
    bounds = header["bounds"]
    tile_id = header["tile_id"]
    for layer in (terrain, layers["roads"], layers["buildings"]):
        if not layer["artifact_sha256"]:
            raise RuntimeError("empty artifact SHA in preview layer")
    if terrain["artifact_role"] != "terrain-height-grid":
        raise RuntimeError(f"unexpected terrain role {terrain['artifact_role']}")
    if layers["roads"]["artifact_role"] != "road-network":
        raise RuntimeError(f"unexpected roads role {layers['roads']['artifact_role']}")
    if layers["buildings"]["artifact_role"] != "building-footprints":
        raise RuntimeError(f"unexpected buildings role {layers['buildings']['artifact_role']}")

    manifest = {
        "schema": "nwe.world-preview-manifest/0.1",
        "preview_id": "nannestad-preview-1",
        "status": "REAL_COMPILED",
        "generated_from_commit": commit_sha,
        "tile": {
            "id": tile_id,
            "horizontal_crs": header["horizontal_crs"],
            "vertical_datum": header["vertical_datum"],
            "bounds": bounds,
            "center_e": (bounds[0] + bounds[2]) / 2,
            "center_n": (bounds[1] + bounds[3]) / 2,
        },
        "terrain": terrain,
        "roads": layers["roads"],
        "buildings": layers["buildings"],
        "preview_semantics": {
            "raw_source_runtime_calls": 0,
            "road_width": "visual-debug-only-3.2m",
            "unresolved_building_height": "visual-debug-only-5m",
            "runtime_distribution": "temporary-preview-runtime-branch-not-final-architecture",
        },
        "attribution": [
            "DTM1 height data: Kartverket / Geonorge, CC BY 4.0.",
            "Road data: Statens vegvesen, NLOD 1.0.",
            "Building data: © OpenStreetMap contributors, ODbL 1.0.",
        ],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output / "ATTRIBUTION.txt").write_text("\n".join(manifest["attribution"]) + "\n", encoding="utf-8")

    files = [path for path in output.rglob("*") if path.is_file()]
    total_bytes = sum(path.stat().st_size for path in files)
    if total_bytes > 16 * 1024 * 1024:
        raise RuntimeError(f"preview snapshot unexpectedly large: {total_bytes} bytes")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage content-addressed Nannestad Preview 1 runtime artifacts")
    parser.add_argument("--terrain-proof-dir", type=Path)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--commit-sha", default=os.environ.get("GITHUB_SHA"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = stage_snapshot(
        terrain_proof_dir=args.terrain_proof_dir,
        cache_root=args.cache_root,
        output=args.output,
        commit_sha=args.commit_sha,
    )
    print(json.dumps({
        "status": "PASS",
        "preview_id": manifest["preview_id"],
        "tile_id": manifest["tile"]["id"],
        "terrain_sha256": manifest["terrain"]["artifact_sha256"],
        "roads_sha256": manifest["roads"]["artifact_sha256"],
        "buildings_sha256": manifest["buildings"]["artifact_sha256"],
        "snapshot_byte_size": sum(path.stat().st_size for path in args.output.rglob("*") if path.is_file()),
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
