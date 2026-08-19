from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from nwe_compiler.nhm_wcs_3x3_candidate import analyze_grid_seams, experimental_height_grid_identity
from nwe_compiler.nhm_wcs_source_candidate import (
    WCS_COVERAGE,
    WCS_ENDPOINT,
    getcoverage_url,
    source_candidate_contract,
    validate_getcoverage,
)
from nwe_compiler.tiles import NANNESTAD_TILE, square_tile_grid

ACCEPTED_ATOM_CENTER_ARTIFACT_SHA256 = "780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96"
USER_AGENT = "NorgeWorldEngine-FORGE/0.1 (+nhm-wcs-3x3-source-candidate)"


def _fetch(url: str, *, accept: str, timeout: float) -> tuple[str | None, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if getattr(response, "status", 200) != 200:
            raise RuntimeError(f"provider returned HTTP {response.status}: {url}")
        return response.headers.get("Content-Type"), response.read()


def _sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _capabilities(timeout: float) -> dict:
    capabilities_url = WCS_ENDPOINT + "?" + urllib.parse.urlencode(
        {"SERVICE": "WCS", "VERSION": "1.0.0", "REQUEST": "GetCapabilities"}
    )
    content_type, payload = _fetch(
        capabilities_url,
        accept="application/xml,text/xml;q=0.9,*/*;q=0.1",
        timeout=timeout,
    )
    root = ET.fromstring(payload)
    coverages = []
    for element in root.iter():
        if element.tag.split("}")[-1] != "CoverageOfferingBrief":
            continue
        for child in list(element):
            if child.tag.split("}")[-1] == "name" and child.text and child.text.strip():
                coverages.append(child.text.strip())
    coverages = sorted(set(coverages))
    if WCS_COVERAGE not in coverages:
        raise RuntimeError(f"expected WCS coverage {WCS_COVERAGE!r} is not advertised: {coverages!r}")
    return {
        "url": capabilities_url,
        "content_type": content_type,
        "byte_size": len(payload),
        "sha256": _sha(payload),
        "advertised_coverages": coverages,
    }


def _describe_coverage(timeout: float) -> dict:
    url = WCS_ENDPOINT + "?" + urllib.parse.urlencode(
        {
            "SERVICE": "WCS",
            "VERSION": "1.0.0",
            "REQUEST": "DescribeCoverage",
            "COVERAGE": WCS_COVERAGE,
        }
    )
    content_type, payload = _fetch(
        url,
        accept="application/xml,text/xml;q=0.9,*/*;q=0.1",
        timeout=timeout,
    )
    root = ET.fromstring(payload)
    text = " ".join((element.text or "").strip() for element in root.iter() if (element.text or "").strip())
    if WCS_COVERAGE not in text:
        raise RuntimeError("DescribeCoverage does not describe the expected coverage")
    return {
        "url": url,
        "content_type": content_type,
        "byte_size": len(payload),
        "sha256": _sha(payload),
    }


def _fetch_tile(tile, destination: Path, *, timeout: float) -> dict:
    url = getcoverage_url(tile)
    content_type, payload = _fetch(
        url,
        accept="image/tiff,application/geotiff,application/octet-stream;q=0.9,*/*;q=0.1",
        timeout=timeout,
    )
    if payload[:4] not in (b"II*\x00", b"MM\x00*"):
        raise RuntimeError(f"{tile.tile_id}: provider response is not TIFF")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    metadata = validate_getcoverage(destination, tile)
    return {**metadata, "content_type": content_type}


def _pass(
    tiles,
    destination: Path,
    *,
    timeout: float,
) -> tuple[dict[str, dict], dict[str, Path]]:
    records: dict[str, dict] = {}
    paths: dict[str, Path] = {}
    for tile in tiles:
        path = destination / f"{tile.tile_id}.tif"
        records[tile.tile_id] = _fetch_tile(tile, path, timeout=timeout)
        paths[tile.tile_id] = path
    return records, paths


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Test official NHM DTM 25832 WCS as a direct 1x1 km NWE terrain source over a real 3x3 grid."
    )
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--proof-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=180.0)
    args = parser.parse_args()

    data_dir = args.data_dir
    proof_dir = args.proof_dir
    if data_dir.exists():
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True)
    proof_dir.mkdir(parents=True, exist_ok=True)

    tiles = square_tile_grid(NANNESTAD_TILE, radius=1)
    if len(tiles) != 9:
        raise RuntimeError(f"expected 9 tiles, got {len(tiles)}")

    capabilities = _capabilities(args.timeout)
    describe = _describe_coverage(args.timeout)
    first, first_paths = _pass(tiles, data_dir / "live-1", timeout=args.timeout)
    second, second_paths = _pass(tiles, data_dir / "live-2", timeout=args.timeout)

    live_repeat: dict[str, dict] = {}
    for tile in tiles:
        a = first[tile.tile_id]
        b = second[tile.tile_id]
        live_repeat[tile.tile_id] = {
            "response_sha256_equal": a["response_sha256"] == b["response_sha256"],
            "response_byte_size_equal": a["response_byte_size"] == b["response_byte_size"],
            "grid_sha256_equal": a["grid_sha256"] == b["grid_sha256"],
            "first_response_sha256": a["response_sha256"],
            "second_response_sha256": b["response_sha256"],
            "first_grid_sha256": a["grid_sha256"],
            "second_grid_sha256": b["grid_sha256"],
        }
        if not live_repeat[tile.tile_id]["grid_sha256_equal"]:
            raise RuntimeError(f"{tile.tile_id}: repeated live WCS request changed elevation grid bytes")

    # Offline repeat: after live acquisition this phase performs no HTTP calls and
    # revalidates the exact cached first-pass TIFF bytes plus runtime-shaped identity.
    offline_records: dict[str, dict] = {}
    experimental_identities: dict[str, dict] = {}
    for tile in tiles:
        offline = validate_getcoverage(first_paths[tile.tile_id], tile)
        if offline["grid_sha256"] != first[tile.tile_id]["grid_sha256"]:
            raise RuntimeError(f"{tile.tile_id}: offline cached grid hash changed")
        offline_records[tile.tile_id] = offline
        experimental_identities[tile.tile_id] = experimental_height_grid_identity(
            first_paths[tile.tile_id], tile
        )

    seams = analyze_grid_seams(first_paths, tiles)
    if seams["seam_count"] != 12:
        raise RuntimeError(f"expected 12 internal seams in 3x3 grid, got {seams['seam_count']}")

    center_id = NANNESTAD_TILE.tile_id
    center_experimental_sha = experimental_identities[center_id]["sha256"]
    total_first_bytes = sum(record["response_byte_size"] for record in first.values())
    total_second_bytes = sum(record["response_byte_size"] for record in second.values())

    result = {
        "schema": "nwe.nhm-wcs-3x3-source-candidate-proof/0.1",
        "source_candidate_contract": source_candidate_contract(),
        "service_evidence": {
            "capabilities": capabilities,
            "describe_coverage": describe,
        },
        "grid": {
            "center_tile_id": center_id,
            "tile_ids": [tile.tile_id for tile in tiles],
            "tile_count": len(tiles),
            "expected_internal_seams": 12,
        },
        "live_first": first,
        "live_second": second,
        "live_repeat": live_repeat,
        "live_repeat_all_grid_sha256_equal": all(
            item["grid_sha256_equal"] for item in live_repeat.values()
        ),
        "live_repeat_all_response_sha256_equal": all(
            item["response_sha256_equal"] for item in live_repeat.values()
        ),
        "offline_cached_repeat": {
            "network_requests": 0,
            "tile_records": offline_records,
            "all_grid_sha256_equal_to_first_live": all(
                offline_records[tile.tile_id]["grid_sha256"] == first[tile.tile_id]["grid_sha256"]
                for tile in tiles
            ),
        },
        "direct_grid_seams": seams,
        "experimental_height_grid_identities": experimental_identities,
        "center_comparison": {
            "accepted_atom_artifact_sha256": ACCEPTED_ATOM_CENTER_ARTIFACT_SHA256,
            "experimental_wcs_runtime_shaped_sha256": center_experimental_sha,
            "byte_identical_to_accepted_atom_artifact": (
                center_experimental_sha == ACCEPTED_ATOM_CENTER_ARTIFACT_SHA256
            ),
            "meaning": (
                "comparison only; WCS is not promoted and no RuntimeVerificationBundle is emitted"
            ),
        },
        "transfer": {
            "first_live_total_response_bytes": total_first_bytes,
            "second_live_total_response_bytes": total_second_bytes,
            "tile_mean_first_response_bytes": total_first_bytes / len(tiles),
        },
        "claim_calibration": {
            "direct_1km_epsg25832_source_path_executed": True,
            "all_nine_tiles_exact_runtime_grid": True,
            "offline_cache_replay_executed": True,
            "production_source_selected": False,
            "production_3x3_promoted": False,
        },
    }

    output = proof_dir / "nhm-wcs-3x3-source-candidate.json"
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
