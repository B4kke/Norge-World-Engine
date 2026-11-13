"""Stage the already accepted, provenance-bound Nannestad base world for A/B.

Presentation experiments must not accidentally drift when OSM/NVDB/Kartverket
deliver different source epochs. This is an *immutable transport* containing
compiled, verified NWE artifacts, not an alternative compiler or new world truth.
The normal runtime verifier still checks the entire artifact/provenance graph.
"""
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

TRANSPORT_COMMIT = "a47b8920fb2a72078734cd3fba56c9cafa6344d5"
PRODUCER_COMMIT = "38d151594b0e3a9bae6e4bc9eabd37693c67a597"
TILE_ID = "epsg25832_611000_6677000_1000m"
ROOT = "nannestad-preview-1"
BASE_URL = f"https://raw.githubusercontent.com/B4kke/Norge-World-Engine/{TRANSPORT_COMMIT}/{ROOT}"
# SHA-256 and byte size are independently pinned, not read as authority
# from the downloaded manifest. Never change these without explicit
# data-promotion evidence and compatible derived building-height/roof layers.
ACCEPTED_ASSETS = {
    "terrain": ("terrain-height-grid", "780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96", 4000382, "nwehgt"),
    "roads": ("road-network", "34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a", 171732, "json"),
    "buildings": ("building-footprints", "678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd", 80846, "json"),
}


def accepted_path(name: str, kind: str) -> str:
    if name not in ACCEPTED_ASSETS:
        raise RuntimeError(f"unknown accepted base layer: {name}")
    role, sha, _, extension = ACCEPTED_ASSETS[name]
    if kind == "bundle":
        return f"{name}.bundle.json"
    if kind == "artifact":
        return f"compiled/{TILE_ID}/{role}/{sha}.{extension}"
    raise ValueError("kind must be bundle or artifact")


def verify_accepted_manifest(manifest: dict) -> None:
    if manifest.get("schema") != "nwe.world-preview-manifest/0.1":
        raise RuntimeError("accepted base manifest schema mismatch")
    if manifest.get("generated_from_commit") != PRODUCER_COMMIT:
        raise RuntimeError("accepted base manifest producer identity mismatch")
    if manifest.get("status") != "REAL_COMPILED_WITH_DERIVED_REALISM":
        raise RuntimeError("accepted base manifest is not the verified realism snapshot")
    tile = manifest.get("tile") or {}
    if (tile.get("id"), tile.get("horizontal_crs"), tile.get("vertical_datum")) != (
        TILE_ID, "EPSG:25832", "NN2000"
    ) or tile.get("bounds") != [611000.0, 6677000.0, 612000.0, 6678000.0]:
        raise RuntimeError("accepted base tile/coordinate reference mismatch")
    for name, (role, sha, size, _) in ACCEPTED_ASSETS.items():
        entry = manifest.get(name) or {}
        if (entry.get("artifact_sha256"), entry.get("artifact_byte_size"), entry.get("artifact_role")) != (sha, size, role):
            raise RuntimeError(f"accepted base {name}: immutable artifact identity mismatch")
        if entry.get("bundle") != f"./{accepted_path(name, 'bundle')}":
            raise RuntimeError(f"accepted base {name}: unexpected bundle path")
        if entry.get("compiled_path") != f"./{accepted_path(name, 'artifact')}":
            raise RuntimeError(f"accepted base {name}: unexpected compiled path")


def stage_accepted_base(output: Path, download, copy_runtime_pair) -> tuple[dict, dict, dict]:
    """Return (terrain-header, terrain-descriptor, road/building descriptors).

    `download` is injectable for deterministic offline tests. Do not use
    the mutable preview-runtime branch or accept arbitrary remote links.
    """
    raw_manifest = download(f"{BASE_URL}/manifest.json")
    manifest = json.loads(raw_manifest.decode("utf-8"))
    verify_accepted_manifest(manifest)

    with tempfile.TemporaryDirectory(prefix="nwe-accepted-world-") as tmp:
        root = Path(tmp)
        layers = {}
        for name, (role, sha, size, _) in ACCEPTED_ASSETS.items():
            artifact_path = root / accepted_path(name, "artifact")
            bundle_path = root / accepted_path(name, "bundle")
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            data = download(f"{BASE_URL}/{accepted_path(name, 'artifact')}")
            if len(data) != size or hashlib.sha256(data).hexdigest() != sha:
                raise RuntimeError(f"accepted base {name}: immutable bytes mismatch")
            artifact_path.write_bytes(data)
            bundle_data = download(f"{BASE_URL}/{accepted_path(name, 'bundle')}")
            bundle = json.loads(bundle_data.decode("utf-8"))
            ref = bundle.get("artifact_ref") or {}
            if (ref.get("sha256"), ref.get("byte_size"), ref.get("artifact_role"), ref.get("tile_id")) != (
                sha, size, role, TILE_ID
            ):
                raise RuntimeError(f"accepted base {name}: runtime-bundle identity mismatch")
            if not bundle.get("artifact_ref_hash") or not bundle.get("compile_lineage"):
                raise RuntimeError(f"accepted base {name}: incomplete provenance bundle")
            bundle_path.write_bytes(bundle_data)
            copied = copy_runtime_pair(
                bundle_path=bundle_path,
                artifact_path=artifact_path,
                output=output,
                bundle_name=accepted_path(name, "bundle"),
            )
            if copied["artifact_sha256"] != sha or copied["compiled_path"] != manifest[name]["compiled_path"]:
                raise RuntimeError(f"accepted base {name}: materialized runtime descriptor mismatch")
            # Add source counters from the exact accepted producer manifest,
            # without using a potentially changed live OSM request.
            metadata = dict(manifest[name])
            metadata.update(copied)
            layers[name] = metadata

    tile = manifest["tile"]
    terrain_header = {
        "tile_id": tile["id"],
        "bounds": tile["bounds"],
        "horizontal_crs": tile["horizontal_crs"],
        "vertical_datum": tile["vertical_datum"],
    }
    return terrain_header, layers["terrain"], {"roads": layers["roads"], "buildings": layers["buildings"]}
