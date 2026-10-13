#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("inventory_polyhaven_tree_assets.py")
spec = importlib.util.spec_from_file_location("polyhaven_inventory", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def gltf_fixture(asset_id: str) -> dict:
    return {
        "asset": {"version": "2.0", "generator": "fixture"},
        "buffers": [{"uri": f"{asset_id}.bin", "byteLength": 900000000}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 100}],
        "accessors": [
            {"bufferView": 0, "count": 120000, "componentType": 5126, "type": "VEC3"},
            {"bufferView": 0, "count": 360000, "componentType": 5125, "type": "SCALAR"},
            {"bufferView": 0, "count": 12000, "componentType": 5126, "type": "VEC3"},
            {"bufferView": 0, "count": 36000, "componentType": 5125, "type": "SCALAR"},
        ],
        "materials": [{"name": "tree"}],
        "meshes": [
            {"name": f"{asset_id}_LOD0", "primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "material": 0}]},
            {"name": f"{asset_id}_LOD2", "primitives": [{"attributes": {"POSITION": 2}, "indices": 3, "material": 0}]},
        ],
        "nodes": [
            {"name": f"{asset_id}_LOD0", "mesh": 0},
            {"name": f"{asset_id}_LOD2", "mesh": 1},
        ],
    }


def manifest_bytes(asset_id: str) -> bytes:
    return json.dumps(gltf_fixture(asset_id), separators=(",", ":"), sort_keys=True).encode("utf-8")


def fixture(asset_id: str, gltf_md5: str) -> dict:
    return {
        "blend": {"1k": {"blend": {"url": f"https://dl.polyhaven.org/{asset_id}_1k.blend", "size": 9000}}},
        "gltf": {
            "1k": {
                "gltf": {"url": f"https://dl.polyhaven.org/{asset_id}_1k.gltf", "size": 1200, "md5": gltf_md5},
                "include": {
                    "texture": {"url": f"https://dl.polyhaven.org/{asset_id}_diff_1k.jpg", "size": 3400, "md5": "b" * 32},
                    "binary": {"url": f"https://dl.polyhaven.org/{asset_id}_1k.bin", "size": 5600, "md5": "c" * 32},
                },
            },
            "2k": {"gltf": {"url": f"https://dl.polyhaven.org/{asset_id}_2k.gltf", "size": 2400}},
        },
    }


asset_id = "pine_tree_01"
raw_manifest = manifest_bytes(asset_id)
manifest_md5 = hashlib.md5(raw_manifest).hexdigest()
metadata_fixture = fixture(asset_id, manifest_md5)
leaves = module.flatten_download_leaves(metadata_fixture)
assert len(leaves) == 5
assert sum(module.is_gltf_1k_leaf(leaf) for leaf in leaves) == 3
manifest_leaf = module.choose_gltf_manifest_leaf(leaves)
assert manifest_leaf is not None and manifest_leaf["url"].endswith("_1k.gltf")

structure = module.summarize_gltf_manifest(gltf_fixture(asset_id))
assert structure["external_buffer_total_bytes"] == 900000000
assert structure["mesh_count"] == 2
assert structure["lod_named_mesh_count"] == 2
assert structure["smallest_meshes"][0]["name"].endswith("LOD2")
assert structure["smallest_meshes"][0]["vertex_count"] == 12000
assert structure["smallest_meshes"][0]["triangle_estimate"] == 12000

summary = module.summarize_asset(
    {
        "asset_id": asset_id,
        "source_page": "https://polyhaven.com/a/pine_tree_01",
        "api_files": "https://api.polyhaven.com/files/pine_tree_01",
        "presentation_groups": ["pine"],
        "truth_guard": "test",
    },
    metadata_fixture,
    gltf_fixture(asset_id),
    {"md5": manifest_md5, "sha256": hashlib.sha256(raw_manifest).hexdigest(), "bytes": len(raw_manifest), "status": 200, "url": manifest_leaf["url"]},
)
assert summary["status"] == "PASS"
assert summary["gltf_1k"]["leaf_count"] == 3
assert summary["gltf_1k"]["known_total_bytes"] == 10200
assert summary["gltf_1k"]["manifest_status"] == "PASS"
assert summary["gltf_1k"]["structure"]["lod_named_mesh_count"] == 2

try:
    module.flatten_download_leaves({"x": {"url": "https://user:pass@example.com/a", "size": 1}})
except ValueError as error:
    assert "unsafe provider URL" in str(error)
else:
    raise AssertionError("credential-bearing provider URL was accepted")

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    for candidate in ("fir_tree_01", "pine_tree_01", "tree_small_02"):
        raw = manifest_bytes(candidate)
        md5 = hashlib.md5(raw).hexdigest()
        (root / f"{candidate}.json").write_text(json.dumps(fixture(candidate, md5)), encoding="utf-8")
        (root / f"{candidate}.gltf.json").write_bytes(raw)
    report = module.build_inventory(root)
    assert report["status"] == "PASS"
    assert report["policy"]["provider_external_geometry_buffers_downloaded"] is False
    assert report["policy"]["provider_texture_bytes_downloaded"] is False
    assert report["policy"]["runtime_provider_network_dependency"] is False
    assert len(report["assets"]) == 3
    assert all(asset["gltf_1k"]["known_total_bytes"] == 10200 for asset in report["assets"])
    assert all(asset["gltf_1k"]["structure"]["lod_named_mesh_count"] == 2 for asset in report["assets"])

print("Poly Haven tree inventory regressions: PASS")
