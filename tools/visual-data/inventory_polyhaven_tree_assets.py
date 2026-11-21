#!/usr/bin/env python3
"""Inventory bounded Poly Haven tree metadata and lightweight glTF structure.

This is a preprocessing/source-audit tool. The browser runtime must never depend on
Poly Haven's API/CDN. It downloads provider metadata plus the small .gltf JSON manifest
only; external geometry buffers and textures are never downloaded by this inventory.
The manifest hash is checked against provider metadata before its mesh/accessor topology
is used to decide whether a bounded offline LOD extraction is viable.
"""
from __future__ import annotations

import argparse
import hashlib
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
MAX_GLTF_MANIFEST_BYTES = 1024 * 1024
MAX_REPORTED_MESHES = 256
USER_AGENT = "NorgeWorldEngine-PolyHavenTreeInventory/0.2 (+https://github.com/B4kke/Norge-World-Engine)"


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


def _safe_http_url(url: str, context: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError(f"unsafe provider URL at {context}")
    return url


def _leaf_from_dict(value: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any] | None:
    url = _first_string(value, ("url", "href", "download_url"))
    if not url:
        return None
    _safe_http_url(url, "/".join(path))
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


def choose_gltf_manifest_leaf(leaves: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [
        leaf for leaf in leaves
        if is_gltf_1k_leaf(leaf)
        and urlparse(leaf["url"]).path.lower().endswith(".gltf")
        and "/include/" not in f"/{leaf['path'].lower()}/"
    ]
    return candidates[0] if len(candidates) == 1 else None


def fetch_json_document(url: str, max_bytes: int) -> tuple[Any, dict[str, Any]]:
    _safe_http_url(url, "fetch")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > max_bytes:
            raise RuntimeError(f"POLYHAVEN_JSON_TOO_LARGE>{max_bytes}")
        raw = response.read(max_bytes + 1)
        if len(raw) > max_bytes:
            raise RuntimeError(f"POLYHAVEN_JSON_TOO_LARGE>{max_bytes}")
        return json.loads(raw.decode("utf-8")), {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "bytes": len(raw),
            "md5": hashlib.md5(raw).hexdigest(),  # provider exposes MD5 for downloadable leaves
            "sha256": hashlib.sha256(raw).hexdigest(),
        }


def _accessor_count(document: dict[str, Any], index: Any) -> int | None:
    if not isinstance(index, int):
        return None
    accessors = document.get("accessors")
    if not isinstance(accessors, list) or index < 0 or index >= len(accessors):
        return None
    return _numeric_size(accessors[index].get("count")) if isinstance(accessors[index], dict) else None


def summarize_gltf_manifest(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise TypeError("POLYHAVEN_GLTF_DOCUMENT_OBJECT_REQUIRED")
    buffers = document.get("buffers") if isinstance(document.get("buffers"), list) else []
    meshes = document.get("meshes") if isinstance(document.get("meshes"), list) else []
    nodes = document.get("nodes") if isinstance(document.get("nodes"), list) else []
    if len(meshes) > MAX_REPORTED_MESHES:
        raise RuntimeError(f"POLYHAVEN_GLTF_TOO_MANY_MESHES>{MAX_REPORTED_MESHES}")

    mesh_rows: list[dict[str, Any]] = []
    for mesh_index, mesh in enumerate(meshes):
        if not isinstance(mesh, dict):
            continue
        primitive_rows = []
        mesh_vertices = 0
        mesh_indices = 0
        for primitive_index, primitive in enumerate(mesh.get("primitives") or []):
            if not isinstance(primitive, dict):
                continue
            attributes = primitive.get("attributes") if isinstance(primitive.get("attributes"), dict) else {}
            position_count = _accessor_count(document, attributes.get("POSITION"))
            index_count = _accessor_count(document, primitive.get("indices"))
            if position_count is not None:
                mesh_vertices += position_count
            if index_count is not None:
                mesh_indices += index_count
            primitive_rows.append({
                "primitive_index": primitive_index,
                "position_accessor": attributes.get("POSITION"),
                "vertex_count": position_count,
                "index_accessor": primitive.get("indices"),
                "index_count": index_count,
                "material": primitive.get("material"),
                "mode": primitive.get("mode", 4),
            })
        mesh_rows.append({
            "mesh_index": mesh_index,
            "name": mesh.get("name"),
            "primitive_count": len(primitive_rows),
            "vertex_count": mesh_vertices,
            "index_count": mesh_indices,
            "triangle_estimate": mesh_indices // 3 if mesh_indices else None,
            "primitives": primitive_rows,
        })

    node_rows = []
    for node_index, node in enumerate(nodes):
        if not isinstance(node, dict) or not isinstance(node.get("mesh"), int):
            continue
        node_rows.append({
            "node_index": node_index,
            "name": node.get("name"),
            "mesh": node.get("mesh"),
            "translation": node.get("translation"),
            "rotation": node.get("rotation"),
            "scale": node.get("scale"),
        })

    lod_meshes = [row for row in mesh_rows if row.get("name") and "lod" in str(row["name"]).lower()]
    lod_nodes = [row for row in node_rows if row.get("name") and "lod" in str(row["name"]).lower()]
    ranked_meshes = sorted(mesh_rows, key=lambda row: (row["vertex_count"], row["index_count"], row["mesh_index"]))
    buffer_rows = []
    for index, buffer in enumerate(buffers):
        if not isinstance(buffer, dict):
            continue
        buffer_rows.append({
            "buffer_index": index,
            "uri": buffer.get("uri"),
            "byte_length": _numeric_size(buffer.get("byteLength")),
        })
    total_buffer_bytes = sum(row["byte_length"] or 0 for row in buffer_rows)
    return {
        "asset": document.get("asset") if isinstance(document.get("asset"), dict) else None,
        "buffer_count": len(buffer_rows),
        "buffers": buffer_rows,
        "external_buffer_total_bytes": total_buffer_bytes,
        "mesh_count": len(mesh_rows),
        "node_with_mesh_count": len(node_rows),
        "accessor_count": len(document.get("accessors") or []),
        "buffer_view_count": len(document.get("bufferViews") or []),
        "material_count": len(document.get("materials") or []),
        "mesh_total_vertices": sum(row["vertex_count"] for row in mesh_rows),
        "mesh_total_indices": sum(row["index_count"] for row in mesh_rows),
        "lod_named_mesh_count": len(lod_meshes),
        "lod_named_node_count": len(lod_nodes),
        "lod_named_meshes": lod_meshes,
        "lod_named_nodes": lod_nodes,
        "smallest_meshes": ranked_meshes[: min(12, len(ranked_meshes))],
        "largest_meshes": list(reversed(ranked_meshes[-min(6, len(ranked_meshes)):])),
        "all_meshes": mesh_rows,
        "nodes_with_meshes": node_rows,
    }


def summarize_asset(asset: dict[str, Any], metadata: Any, gltf_manifest: Any | None = None, gltf_http: dict[str, Any] | None = None) -> dict[str, Any]:
    leaves = flatten_download_leaves(metadata)
    gltf_1k = [leaf for leaf in leaves if is_gltf_1k_leaf(leaf)]
    known_sizes = [leaf["bytes"] for leaf in gltf_1k if leaf["bytes"] is not None]
    manifest_leaf = choose_gltf_manifest_leaf(leaves)
    manifest_summary = None
    manifest_status = "NOT_FETCHED"
    if gltf_manifest is not None and manifest_leaf is not None:
        manifest_summary = summarize_gltf_manifest(gltf_manifest)
        expected_md5 = manifest_leaf.get("md5")
        actual_md5 = gltf_http.get("md5") if gltf_http else None
        if expected_md5 and actual_md5 and expected_md5 != actual_md5:
            raise RuntimeError(f"POLYHAVEN_GLTF_MANIFEST_MD5_MISMATCH:{asset['asset_id']}")
        manifest_status = "PASS"
    elif manifest_leaf is None:
        manifest_status = "FAIL_MANIFEST_LEAF_AMBIGUOUS"

    status = "PASS" if gltf_1k and manifest_leaf is not None and manifest_status == "PASS" else "FAIL"
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
            "manifest_leaf": manifest_leaf,
            "manifest_fetch": gltf_http,
            "manifest_status": manifest_status,
            "structure": manifest_summary,
        },
        "status": status,
    }


def load_catalog() -> dict[str, Any]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if catalog.get("schema") != "nwe.polyhaven-tree-candidate-catalog/0.1":
        raise RuntimeError("POLYHAVEN_TREE_CATALOG_SCHEMA")
    if catalog.get("license", {}).get("spdx_like") != "CC0-1.0":
        raise RuntimeError("POLYHAVEN_TREE_CATALOG_LICENSE")
    return catalog


def load_asset_metadata(asset: dict[str, Any], fixture_dir: Path | None) -> Any:
    if fixture_dir is None:
        return fetch_json_document(asset["api_files"], MAX_METADATA_BYTES)[0]
    fixture = fixture_dir / f"{asset['asset_id']}.json"
    return json.loads(fixture.read_text(encoding="utf-8"))


def load_gltf_manifest(asset: dict[str, Any], metadata: Any, fixture_dir: Path | None) -> tuple[Any, dict[str, Any]]:
    leaves = flatten_download_leaves(metadata)
    manifest_leaf = choose_gltf_manifest_leaf(leaves)
    if manifest_leaf is None:
        raise RuntimeError(f"POLYHAVEN_GLTF_MANIFEST_LEAF_AMBIGUOUS:{asset['asset_id']}")
    if fixture_dir is not None:
        raw = (fixture_dir / f"{asset['asset_id']}.gltf.json").read_bytes()
        return json.loads(raw.decode("utf-8")), {
            "url": manifest_leaf["url"],
            "status": 200,
            "content_type": "model/gltf+json",
            "bytes": len(raw),
            "md5": hashlib.md5(raw).hexdigest(),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
    return fetch_json_document(manifest_leaf["url"], MAX_GLTF_MANIFEST_BYTES)


def build_inventory(fixture_dir: Path | None = None) -> dict[str, Any]:
    catalog = load_catalog()
    results = []
    for asset in catalog["assets"]:
        try:
            metadata = load_asset_metadata(asset, fixture_dir)
            gltf_manifest, gltf_http = load_gltf_manifest(asset, metadata, fixture_dir)
            results.append(summarize_asset(asset, metadata, gltf_manifest, gltf_http))
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
        "schema": "nwe.polyhaven-tree-download-inventory/0.2",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if passed else "FAIL",
        "policy": {
            "metadata_only": True,
            "gltf_manifest_json_downloaded": True,
            "provider_external_geometry_buffers_downloaded": False,
            "provider_texture_bytes_downloaded": False,
            "runtime_provider_network_dependency": False,
            "raw_model_bytes_committable": False,
            "next_stage_requires_bounded_lod_extraction": True,
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
