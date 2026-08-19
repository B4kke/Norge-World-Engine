from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

CACHE_PREFIX = "cache://compiled/"
RAW_MARKERS = ("kartverket", "geonorge", "vegvesen", "nvdb", "overpass", "openstreetmap")
PREVIEW_TERRAIN_RADIUS = 1
PREVIEW_TERRAIN_TILE_COUNT = 9
PREVIEW_SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024


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
    bundle_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(bundle_path, bundle_target)
    compiled_target = output / "compiled" / compiled_relative(bundle)
    compiled_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(artifact_path, compiled_target)
    return {
        "bundle": f"./{Path(bundle_name).as_posix()}",
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


def _tile_manifest(tile, header: dict) -> dict:
    bounds = list(header["bounds"])
    return {
        "id": tile.tile_id,
        "horizontal_crs": header["horizontal_crs"],
        "vertical_datum": header["vertical_datum"],
        "bounds": bounds,
        "center_e": (bounds[0] + bounds[2]) / 2,
        "center_n": (bounds[1] + bounds[3]) / 2,
        "elevation_min_m": header["elevation_min_m"],
        "elevation_max_m": header["elevation_max_m"],
    }


def build_terrain_grid(cache_root: Path) -> tuple[list[tuple[object, Path, Path, dict]], dict]:
    from nwe_compiler.nhm_wcs_acquisition import USER_AGENT, acquire_nhm_wcs
    from nwe_compiler.nhm_wcs_terrain_artifacts import (
        compile_nhm_wcs_terrain_artifact,
        persist_nhm_wcs_terrain_artifact,
    )
    from nwe_compiler.tiles import NANNESTAD_TILE, square_tile_grid

    tiles = square_tile_grid(NANNESTAD_TILE, radius=PREVIEW_TERRAIN_RADIUS)
    if len(tiles) != PREVIEW_TERRAIN_TILE_COUNT:
        raise RuntimeError(f"expected {PREVIEW_TERRAIN_TILE_COUNT} terrain tiles, got {len(tiles)}")

    response_cache: dict[str, tuple[str | None, bytes]] = {}
    network_calls: list[str] = []

    def shared_fetcher(url: str, timeout: float, accept: str) -> tuple[str | None, bytes]:
        is_service_metadata = "GetCapabilities" in url or "DescribeCoverage" in url
        if is_service_metadata and url in response_cache:
            return response_cache[url]
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if getattr(response, "status", 200) != 200:
                raise RuntimeError(f"provider returned HTTP {response.status}: {url}")
            result = (response.headers.get("Content-Type"), response.read())
        network_calls.append(url)
        if is_service_metadata:
            response_cache[url] = result
        return result

    results: list[tuple[object, Path, Path, dict]] = []
    for tile in tiles:
        acquired = acquire_nhm_wcs(
            cache_root,
            tile=tile,
            refresh=True,
            timeout=180,
            fetcher=shared_fetcher,
        )
        compiled = compile_nhm_wcs_terrain_artifact(acquired, tile=tile)
        persisted = persist_nhm_wcs_terrain_artifact(compiled, cache_root, tile=tile)
        if not persisted.bundle_path or not persisted.artifact_path:
            raise RuntimeError(f"{tile.tile_id}: terrain artifact was not persisted")
        results.append(
            (
                tile,
                Path(persisted.bundle_path),
                Path(persisted.artifact_path),
                compiled.artifact_header,
            )
        )

    expected_requests = 2 + len(tiles)
    if len(network_calls) != expected_requests:
        raise RuntimeError(
            f"expected {expected_requests} provider requests (2 shared metadata + {len(tiles)} coverage), "
            f"got {len(network_calls)}"
        )
    return results, {
        "provider_requests": len(network_calls),
        "shared_service_metadata_requests": 2,
        "coverage_requests": len(tiles),
    }


def build_legacy_terrain(cache_root: Path, working_dir: Path) -> tuple[Path, Path, dict]:
    """Historical D-007 single-tile path retained only for explicit legacy proof input."""
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

    terrain_tiles: list[dict] = []
    terrain_network = {"provider_requests": 0, "shared_service_metadata_requests": 0, "coverage_requests": 0}

    if terrain_proof_dir is not None:
        # Backward-compatible explicit legacy proof staging. Normal live Preview builds
        # use the direct WCS 3x3 path below.
        terrain_report = read_json(terrain_proof_dir / "dtm1-realdata-proof.json")
        terrain_info = terrain_report["compiled_artifact"]
        terrain_bundle_path = terrain_proof_dir / terrain_info["bundle_file"]
        terrain_artifact_path = terrain_proof_dir / terrain_info["artifact_file"]
        terrain_header = terrain_info["header"]
        terrain = copy_runtime_pair(
            bundle_path=terrain_bundle_path,
            artifact_path=terrain_artifact_path,
            output=output,
            bundle_name="terrain.bundle.json",
        )
        terrain["tile"] = {
            "id": terrain_header["tile_id"],
            "horizontal_crs": terrain_header["horizontal_crs"],
            "vertical_datum": terrain_header["vertical_datum"],
            "bounds": terrain_header["bounds"],
            "center_e": (terrain_header["bounds"][0] + terrain_header["bounds"][2]) / 2,
            "center_n": (terrain_header["bounds"][1] + terrain_header["bounds"][3]) / 2,
            "elevation_min_m": terrain_header["elevation_min_m"],
            "elevation_max_m": terrain_header["elevation_max_m"],
        }
        terrain_tiles.append(terrain)
    else:
        terrain_grid, terrain_network = build_terrain_grid(cache_root)
        center_id = "epsg25832_611000_6677000_1000m"
        terrain = None
        terrain_header = None
        for tile, bundle_path, artifact_path, header in terrain_grid:
            layer = copy_runtime_pair(
                bundle_path=bundle_path,
                artifact_path=artifact_path,
                output=output,
                bundle_name=f"terrain/{tile.tile_id}.bundle.json",
            )
            layer["tile"] = _tile_manifest(tile, header)
            terrain_tiles.append(layer)
            if tile.tile_id == center_id:
                terrain = dict(layer)
                terrain_header = header
        if terrain is None or terrain_header is None:
            raise RuntimeError(f"3x3 terrain grid did not contain center tile {center_id}")
        # Stable center alias keeps manifest 0.1 consumers working while the new
        # terrain_tiles field exposes all nine independently verified runtime tiles.
        center_bundle_source = output / terrain["bundle"].removeprefix("./")
        shutil.copyfile(center_bundle_source, output / "terrain.bundle.json")
        terrain["bundle"] = "./terrain.bundle.json"

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
    for layer in [*terrain_tiles, layers["roads"], layers["buildings"]]:
        if not layer["artifact_sha256"]:
            raise RuntimeError("empty artifact SHA in preview layer")
    if any(layer["artifact_role"] != "terrain-height-grid" for layer in terrain_tiles):
        raise RuntimeError("unexpected terrain role in preview terrain grid")
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
            "elevation_min_m": header["elevation_min_m"],
            "elevation_max_m": header["elevation_max_m"],
        },
        "terrain": terrain,
        "terrain_tiles": terrain_tiles,
        "roads": layers["roads"],
        "buildings": layers["buildings"],
        "preview_semantics": {
            "raw_source_runtime_calls": 0,
            "terrain_runtime_grid": "3x3-1km" if len(terrain_tiles) == PREVIEW_TERRAIN_TILE_COUNT else "legacy-single-tile",
            "terrain_tile_count": len(terrain_tiles),
            "terrain_source_path": "kartverket-nhm-dtm-25832-wcs-direct-runtime-grid" if len(terrain_tiles) == PREVIEW_TERRAIN_TILE_COUNT else "historical-dtm1-atom",
            "terrain_provider_requests_during_compile": terrain_network,
            "vectors_scope": "center-1x1km-only",
            "road_width": "visual-debug-only-3.2m",
            "unresolved_building_height": "visual-debug-only-5m",
            "runtime_distribution": "temporary-preview-runtime-branch-not-final-architecture",
        },
        "attribution": [
            "NHM DTM height data: © Kartverket, CC BY 4.0.",
            "Road data: Statens vegvesen, NLOD 1.0.",
            "Building data: © OpenStreetMap contributors, ODbL 1.0.",
        ],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output / "ATTRIBUTION.txt").write_text("\n".join(manifest["attribution"]) + "\n", encoding="utf-8")

    files = [path for path in output.rglob("*") if path.is_file()]
    total_bytes = sum(path.stat().st_size for path in files)
    if total_bytes > PREVIEW_SNAPSHOT_MAX_BYTES:
        raise RuntimeError(f"preview snapshot unexpectedly large: {total_bytes} bytes")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage content-addressed Nannestad Preview runtime artifacts")
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
        "terrain_tile_count": len(manifest["terrain_tiles"]),
        "terrain_sha256": manifest["terrain"]["artifact_sha256"],
        "terrain_artifact_bytes": sum(item["artifact_byte_size"] for item in manifest["terrain_tiles"]),
        "roads_sha256": manifest["roads"]["artifact_sha256"],
        "buildings_sha256": manifest["buildings"]["artifact_sha256"],
        "snapshot_byte_size": sum(path.stat().st_size for path in args.output.rglob("*") if path.is_file()),
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
