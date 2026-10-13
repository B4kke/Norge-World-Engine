#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("inventory_polyhaven_tree_assets.py")
spec = importlib.util.spec_from_file_location("polyhaven_inventory", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def fixture(asset_id: str) -> dict:
    return {
        "blend": {"1k": {"blend": {"url": f"https://dl.polyhaven.org/{asset_id}_1k.blend", "size": 9000}}},
        "gltf": {
            "1k": {
                "gltf": {"url": f"https://dl.polyhaven.org/{asset_id}_1k.gltf", "size": 1200, "md5": "a" * 32},
                "include": {
                    "texture": {"url": f"https://dl.polyhaven.org/{asset_id}_diff_1k.jpg", "size": 3400, "md5": "b" * 32},
                    "binary": {"url": f"https://dl.polyhaven.org/{asset_id}_1k.bin", "size": 5600, "md5": "c" * 32},
                },
            },
            "2k": {"gltf": {"url": f"https://dl.polyhaven.org/{asset_id}_2k.gltf", "size": 2400}},
        },
    }


leaves = module.flatten_download_leaves(fixture("pine_tree_01"))
assert len(leaves) == 5
assert sum(module.is_gltf_1k_leaf(leaf) for leaf in leaves) == 3
summary = module.summarize_asset({
    "asset_id": "pine_tree_01",
    "source_page": "https://polyhaven.com/a/pine_tree_01",
    "api_files": "https://api.polyhaven.com/files/pine_tree_01",
    "presentation_groups": ["pine"],
    "truth_guard": "test",
}, fixture("pine_tree_01"))
assert summary["status"] == "PASS"
assert summary["gltf_1k"]["leaf_count"] == 3
assert summary["gltf_1k"]["known_total_bytes"] == 10200

try:
    module.flatten_download_leaves({"x": {"url": "https://user:pass@example.com/a", "size": 1}})
except ValueError as error:
    assert "unsafe provider URL" in str(error)
else:
    raise AssertionError("credential-bearing provider URL was accepted")

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    for asset_id in ("fir_tree_01", "pine_tree_01", "tree_small_02"):
        (root / f"{asset_id}.json").write_text(json.dumps(fixture(asset_id)), encoding="utf-8")
    report = module.build_inventory(root)
    assert report["status"] == "PASS"
    assert report["policy"]["provider_model_bytes_downloaded"] is False
    assert report["policy"]["runtime_provider_network_dependency"] is False
    assert len(report["assets"]) == 3
    assert all(asset["gltf_1k"]["known_total_bytes"] == 10200 for asset in report["assets"])

print("Poly Haven tree inventory regressions: PASS")
