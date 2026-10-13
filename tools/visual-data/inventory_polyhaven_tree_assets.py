#!/usr/bin/env python3
"""Inventory Poly Haven tree download metadata without downloading model bytes.

This is a preprocessing/source-audit tool. The browser runtime must never depend on
Poly Haven's API/CDN. It normalizes provider metadata into a small report so a later
asset-admission step can pin one bounded glTF file closure and preprocess it offline.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

CATALOG_PATH = Path(__file__).with_name("polyhaven_tree_candidates.json")
MAX_METADATA_BYTES = 8 * 1024 * 1024
USER_AGENT = "NorgeWorldEngine-PolyHavenTreeInventory/0.1 (+https://github.com/B4kke/Norge-World-Engine)"


def _numeric_size(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, float) and value >= 0 and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _first_string(mapping: dict[str, Any], keys: Iterable[str]) -> str | None:
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _leaf_from_dict(value: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any] | None:
    url = _first_string(value, ("url", "href", "download_url"))
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError(f"unsafe provider URL at {'/'.join(path)}")
    size = None
    for key in ("size", "bytes", "byte_size", "filesize"):
        size = _numeric_size(value.get(key))
        if size is not None:
            break
    return {
        "path": "/".join(path),
        "url": url,
        "bytes": size,
        "md5": _first_string(value, ("md5", "checksum_md5")),
        "sha256": _first_string(value, ("sha256", "checksum_sha256")),
    }


def flatten_download_leaves(value: Any, path: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    leaves: list[dict[str, Any]] = []
    if isinstance(value, dict):
        leaf = _leaf_from_dict(value, path)
        if leaf:
            leaves.append(leaf)
        for key in sorted(value):
            if key in {"url", "href", "download_url", "size", "bytes", "byte_size", "filesize", "md5", "checksum_md5", "sha256", "checksum_sha256"}:
                continue
            leaves.extend(flatten_download_leaves(value[key], (*path, str(key))))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            leaves.extend(flatten_download_leaves(item, (*path, str(index))))
    return leaves


def _path_tokens(leaf: dict[str, Any]) -> str:
    return f"{leaf['path']} {leaf['url']}".lower()


def is_gltf_1k_leaf(leaf: dict[str, Any]) -> bool:
    haystack = _path_tokens(leaf)
    has_gltf = "gltf" in haystack or ".glb" in haystack
    has_1k = bool(re.search(r"(^|[^0-9a-z])1k([^0-9a-z]|$)", haystack))
    return has_gltf and has_1k


def summarize_asset(asset: dict[str, Any], metadata: Any) -> dict[str, Any]:
    leaves = flatten_download_leaves(metadata)
    gltf_1k = [leaf for leaf in leaves if is_gltf_1k_leaf(leaf)]
    known_sizes = [leaf["bytes"] for leaf in gltf_1k if leaf["bytes"] is not None]
    return {
        "asset_id": asset["asset_id"],
        "source_page": asset["source_page"],
        "api_files": asset["api_files"],
        "presentation_groups": asset["presentation_groups"],
        "truth_guard": asset["truth_guard"],
        "download_leaf_count": len(leaves),
        "download_leaves": leaves,
        "gltf_1k": {
            "leaf_count": len(gltf_1k),
            "known_size_leaf_count": len(known_sizes),
            "known_total_bytes": sum(known_sizes) if known_sizes else None,
            "leaves": gltf_1k,
        },
        "status": "PASS" if gltf_1k else "FAIL_NO_1K_GLTF_METADATA",
    }


def fetch_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_METADATA_BYTES:
            raise RuntimeError(f"POLYHAVEN_METADATA_TOO_LARGE>{MAX_METADATA_BYTES}")
        payload = response.read(MAX_METADATA_BYTES + 1)
        if len(payload) > MAX_METADATA_BYTES:
            raise RuntimeError(f"POLYHAVEN_METADATA_TOO_LARGE>{MAX_METADATA_BYTES}")
        return json.loads(payload.decode("utf-8"))


def load_catalog() -> dict[str, Any]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if catalog.get("schema") != "nwe.polyhaven-tree-candidate-catalog/0.1":
        raise RuntimeError("POLYHAVEN_TREE_CATALOG_SCHEMA")
    if catalog.get("license", {}).get("spdx_like") != "CC0-1.0":
        raise RuntimeError("POLYHAVEN_TREE_CATALOG_LICENSE")
    return catalog


def load_asset_metadata(asset: dict[str, Any], fixture_dir: Path | None) -> Any:
    if fixture_dir is None:
        return fetch_json(asset["api_files"])
    fixture = fixture_dir / f"{asset['asset_id']}.json"
    return json.loads(fixture.read_text(encoding="utf-8"))


def build_inventory(fixture_dir: Path | None = None) -> dict[str, Any]:
    catalog = load_catalog()
    results = []
    for asset in catalog["assets"]:
        try:
            results.append(summarize_asset(asset, load_asset_metadata(asset, fixture_dir)))
        except Exception as error:
            results.append({
                "asset_id": asset["asset_id"],
                "source_page": asset["source_page"],
                "api_files": asset["api_files"],
                "status": "FAIL",
                "error": repr(error),
            })
    passed = all(item.get("status") == "PASS" for item in results)
    return {
        "schema": "nwe.polyhaven-tree-download-inventory/0.1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if passed else "FAIL",
        "policy": {
            "metadata_only": True,
            "provider_model_bytes_downloaded": False,
            "runtime_provider_network_dependency": False,
            "raw_model_bytes_committable": False,
            "next_stage_requires_pinned_file_closure": True,
        },
        "license": catalog["license"],
        "preprocessing_policy": catalog["preprocessing_policy"],
        "assets": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--fixture-dir")
    args = parser.parse_args()
    fixture_dir = Path(args.fixture_dir).resolve() if args.fixture_dir else None
    report = build_inventory(fixture_dir)
    Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
