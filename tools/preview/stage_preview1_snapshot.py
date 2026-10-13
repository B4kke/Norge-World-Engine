from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

CACHE_PREFIX = "cache://compiled/"
RAW_MARKERS = ("kartverket", "geonorge", "vegvesen", "nvdb", "overpass", "openstreetmap")

BUILDING_RUNTIME_COMMIT = "7a0e49b1743d209bbc2d85af901915e4009e7d7f"
VEGETATION_RUNTIME_COMMIT = "c8de691494edb550aa4c43812efdeec3facf24a1"
RUNTIME_ROOT = "nannestad-preview-1"
BUILDING_ARTIFACT_SHA256 = "678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd"
REALISM_SPECS = {
    "building_surface": {
        "filename": "building-surface.json",
        "commit": BUILDING_RUNTIME_COMMIT,
        "sha256": "7b07c587cbbf3e42685cc53d9751fa04471d247e2ab9601daa26e75a2e13721a",
        "schema": "nwe.building-surface-artifact/0.1-candidate",
        "compiler_config_id": "d80cb89ff57170f0bfd6b341c5c6072654919dc29f81954b7eb52753e6477f15",
    },
    "roof_orientation": {
        "filename": "building-roof-orientation.json",
        "commit": BUILDING_RUNTIME_COMMIT,
        "sha256": "0f6eedb225821da4e0760b96cb843ec01707f99478691c85c8304d847c7270d3",
        "schema": "nwe.building-roof-orientation-artifact/0.1-candidate",
        "compiler_config_id": "325cd39feca447c9b1a8995d805525ee9abf37359d5089e9df81069c916b8682",
    },
    "vegetation": {
        "filename": "vegetation-representatives.json",
        "commit": VEGETATION_RUNTIME_COMMIT,
        "sha256": "ceececdf22de88710f7eba4dd7d131a33f123b216bd3ca235e960ca9816c1686",
        "schema": "nwe.vegetation-representative-artifact/0.1-candidate",
        "compiler_config_id": "f3a3206a559c00196c2a8fc9c397697aae20bef98a25e5e598766fc4de5bd90e",
    },
}


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


def download_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "NWE-Preview-Stager/0.2"})
    with urlopen(request, timeout=60) as response:
        if response.status != 200:
            raise RuntimeError(f"realism download failed HTTP {response.status}: {url}")
        return response.read()


def stage_realism_layers(output: Path, *, tile_id: str) -> dict[str, dict]:
    realism_dir = output / "realism"
    realism_dir.mkdir(parents=True, exist_ok=True)
    descriptors: dict[str, dict] = {}
    for name, spec in REALISM_SPECS.items():
        url = (
            "https://raw.githubusercontent.com/B4kke/Norge-World-Engine/"
            f"{spec['commit']}/{RUNTIME_ROOT}/{spec['filename']}"
        )
        data = download_bytes(url)
        actual_sha = hashlib.sha256(data).hexdigest()
        if actual_sha != spec["sha256"]:
            raise RuntimeError(f"{name}: immutable realism artifact SHA mismatch {actual_sha} != {spec['sha256']}")
        try:
            value = json.loads(data.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"{name}: invalid JSON: {exc}") from exc
        if value.get("schema") != spec["schema"]:
            raise RuntimeError(f"{name}: schema mismatch {value.get('schema')!r}")
        if value.get("tile_id") != tile_id:
            raise RuntimeError(f"{name}: tile mismatch {value.get('tile_id')!r} != {tile_id}")
        if value.get("horizontal_crs") != "EPSG:25832":
            raise RuntimeError(f"{name}: CRS mismatch {value.get('horizontal_crs')!r}")
        if value.get("compiler_config_id") != spec["compiler_config_id"]:
            raise RuntimeError(f"{name}: compiler config mismatch")
        if name in {"building_surface", "roof_orientation"}:
            source = value.get("source") or {}
            if source.get("building_artifact_sha256") != BUILDING_ARTIFACT_SHA256:
                raise RuntimeError(f"{name}: base building artifact mismatch")
        if name == "building_surface" and len(value.get("features") or []) < 100:
            raise RuntimeError("building_surface: too few features")
        if name == "roof_orientation" and len(value.get("features") or []) < 10:
            raise RuntimeError("roof_orientation: too few strong features")
        if name == "vegetation" and len(value.get("instances") or []) < 100:
            raise RuntimeError("vegetation: too few representative instances")

        target = realism_dir / spec["filename"]
        target.write_bytes(data)
        descriptors[name] = {
            "path": f"./realism/{spec['filename']}",
            "artifact_sha256": actual_sha,
            "artifact_byte_size": len(data),
            "schema": spec["schema"],
            "compiler_config_id": spec["compiler_config_id"],
            "transport_commit": spec["commit"],
            "truth_status": "derived-candidate-explicit-not-surveyed-individual-detail",
        }
    return descriptors


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
        if "semantic_stats" in item:
            layer["semantic_stats"] = item["semantic_stats"]
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
    if layers["buildings"]["artifact_sha256"] != BUILDING_ARTIFACT_SHA256:
        raise RuntimeError("realism enrichment is calibrated only for the accepted Nannestad building artifact")

    realism_layers = stage_realism_layers(output, tile_id=tile_id)
    manifest = {
        "schema": "nwe.world-preview-manifest/0.1",
        "preview_id": "nannestad-preview-1",
        "status": "REAL_COMPILED_WITH_DERIVED_REALISM",
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
        "realism_layers": realism_layers,
        "preview_semantics": {
            "raw_source_runtime_calls": 0,
            "road_width": "source-backed-when-present-otherwise-explicit-3.2m-renderer-fallback",
            "building_height": "OSM-source-first; guarded-NHM-DOM-minus-DTM-p90-presentation; explicit-fallback-otherwise",
            "roof_direction": "strong-NHM-DOM-derived-direction-may-orient-renderer-policy-gables; roof-shape-not-surveyed",
            "vegetation": "NIBIO-SR16V-source-semantics-with-deterministic-representative-positions; not-observed-individual-trees",
            "runtime_distribution": "preview-runtime-artifact-package",
        },
        "attribution": [
            "DTM1 height data: Kartverket / Geonorge, CC BY 4.0.",
            "NHM DOM-derived building surface measurements: Kartverket / Geonorge; downstream derived candidate, source terms retained in provenance.",
            "Road data: Statens vegvesen, NLOD 1.0.",
            "Building footprints: © OpenStreetMap contributors, ODbL 1.0.",
            "Forest semantics: Kilde: NIBIO, SR16V, NLOD 1.0.",
        ],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output / "ATTRIBUTION.txt").write_text("\n".join(manifest["attribution"]) + "\n", encoding="utf-8")

    files = [path for path in output.rglob("*") if path.is_file()]
    total_bytes = sum(path.stat().st_size for path in files)
    if total_bytes > 20 * 1024 * 1024:
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
        "realism_layers": {name: value["artifact_sha256"] for name, value in manifest["realism_layers"].items()},
        "snapshot_byte_size": sum(path.stat().st_size for path in args.output.rglob("*") if path.is_file()),
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
