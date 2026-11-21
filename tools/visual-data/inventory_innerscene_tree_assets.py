#!/usr/bin/env python3
"""Inventory lightweight CC0 Innerscene tree candidates without retaining provider bytes.

The probe fetches each source page to verify the current CC0 marker, downloads the bounded
GLB only inside preprocessing/CI, computes immutable hashes, parses the GLB v2 JSON chunk,
and records geometry/material counts. Raw provider model bytes are discarded and never
become a browser runtime dependency.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

CATALOG_PATH = Path(__file__).with_name("innerscene_tree_candidates.json")
MAX_SOURCE_PAGE_BYTES = 1024 * 1024
USER_AGENT = "NorgeWorldEngine-InnersceneTreeInventory/0.1 (+https://github.com/B4kke/Norge-World-Engine)"
GLB_MAGIC = b"glTF"
GLB_VERSION = 2
JSON_CHUNK_TYPE = b"JSON"
BIN_CHUNK_TYPE = b"BIN\x00"


def safe_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError(f"unsafe URL: {url}")
    return url


def fetch_bytes(url: str, max_bytes: int, accept: str) -> tuple[bytes, dict[str, Any]]:
    safe_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > max_bytes:
            raise RuntimeError(f"INNERSCENE_RESPONSE_TOO_LARGE>{max_bytes}:{url}")
        raw = response.read(max_bytes + 1)
        if len(raw) > max_bytes:
            raise RuntimeError(f"INNERSCENE_RESPONSE_TOO_LARGE>{max_bytes}:{url}")
        return raw, {
            "url": response.geturl(),
            "status": response.status,
            "content_type": response.headers.get("Content-Type"),
            "content_disposition": response.headers.get("Content-Disposition"),
            "content_length_header": content_length,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "md5": hashlib.md5(raw).hexdigest(),
        }


def parse_glb(raw: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
    if len(raw) < 20:
        raise ValueError("GLB_TOO_SHORT")
    magic, version, declared_length = struct.unpack_from("<4sII", raw, 0)
    if magic != GLB_MAGIC:
        raise ValueError(f"GLB_MAGIC:{magic!r}")
    if version != GLB_VERSION:
        raise ValueError(f"GLB_VERSION:{version}")
    if declared_length != len(raw):
        raise ValueError(f"GLB_LENGTH:{declared_length}!={len(raw)}")

    offset = 12
    chunks: list[dict[str, Any]] = []
    json_document = None
    while offset < len(raw):
        if offset + 8 > len(raw):
            raise ValueError("GLB_TRUNCATED_CHUNK_HEADER")
        chunk_length, chunk_type = struct.unpack_from("<I4s", raw, offset)
        offset += 8
        end = offset + chunk_length
        if end > len(raw):
            raise ValueError("GLB_TRUNCATED_CHUNK")
        payload = raw[offset:end]
        chunks.append({"type": chunk_type.decode("ascii", errors="replace"), "bytes": chunk_length})
        if chunk_type == JSON_CHUNK_TYPE:
            if json_document is not None:
                raise ValueError("GLB_MULTIPLE_JSON_CHUNKS")
            json_document = json.loads(payload.rstrip(b" \t\r\n\x00").decode("utf-8"))
        offset = end
    if offset != len(raw):
        raise ValueError("GLB_CHUNK_ALIGNMENT")
    if not isinstance(json_document, dict):
        raise ValueError("GLB_JSON_CHUNK_MISSING")
    return json_document, {
        "version": version,
        "declared_length": declared_length,
        "chunk_count": len(chunks),
        "chunks": chunks,
        "has_bin_chunk": any(chunk["type"] == "BIN\u0000" for chunk in chunks),
    }


def _numeric(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def accessor_count(document: dict[str, Any], index: Any) -> int | None:
    accessors = document.get("accessors")
    if not isinstance(index, int) or not isinstance(accessors, list) or index < 0 or index >= len(accessors):
        return None
    accessor = accessors[index]
    return _numeric(accessor.get("count")) if isinstance(accessor, dict) else None


def summarize_geometry(document: dict[str, Any]) -> dict[str, Any]:
    meshes = document.get("meshes") if isinstance(document.get("meshes"), list) else []
    rows = []
    total_vertices = 0
    total_indices = 0
    total_triangles = 0
    for mesh_index, mesh in enumerate(meshes):
        if not isinstance(mesh, dict):
            continue
        primitive_rows = []
        mesh_vertices = 0
        mesh_indices = 0
        mesh_triangles = 0
        for primitive_index, primitive in enumerate(mesh.get("primitives") or []):
            if not isinstance(primitive, dict):
                continue
            attributes = primitive.get("attributes") if isinstance(primitive.get("attributes"), dict) else {}
            vertices = accessor_count(document, attributes.get("POSITION")) or 0
            indices = accessor_count(document, primitive.get("indices")) or 0
            mode = primitive.get("mode", 4)
            triangles = indices // 3 if mode == 4 and indices else (vertices // 3 if mode == 4 else 0)
            mesh_vertices += vertices
            mesh_indices += indices
            mesh_triangles += triangles
            primitive_rows.append({
                "primitive_index": primitive_index,
                "mode": mode,
                "vertex_count": vertices,
                "index_count": indices,
                "triangle_estimate": triangles,
                "material": primitive.get("material"),
            })
        total_vertices += mesh_vertices
        total_indices += mesh_indices
        total_triangles += mesh_triangles
        rows.append({
            "mesh_index": mesh_index,
            "name": mesh.get("name"),
            "primitive_count": len(primitive_rows),
            "vertex_count": mesh_vertices,
            "index_count": mesh_indices,
            "triangle_estimate": mesh_triangles,
            "primitives": primitive_rows,
        })
    rows_by_size = sorted(rows, key=lambda item: (item["triangle_estimate"], item["vertex_count"], item["mesh_index"]))
    return {
        "mesh_count": len(rows),
        "primitive_count": sum(row["primitive_count"] for row in rows),
        "accessor_count": len(document.get("accessors") or []),
        "material_count": len(document.get("materials") or []),
        "texture_count": len(document.get("textures") or []),
        "image_count": len(document.get("images") or []),
        "node_count": len(document.get("nodes") or []),
        "total_vertices": total_vertices,
        "total_indices": total_indices,
        "triangle_estimate": total_triangles,
        "smallest_meshes": rows_by_size[: min(8, len(rows_by_size))],
        "largest_meshes": list(reversed(rows_by_size[-min(8, len(rows_by_size)):])),
    }


def load_catalog() -> dict[str, Any]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if catalog.get("schema") != "nwe.innerscene-tree-candidate-catalog/0.1":
        raise RuntimeError("INNERSCENE_CATALOG_SCHEMA")
    if catalog.get("license", {}).get("spdx_like") != "CC0-1.0":
        raise RuntimeError("INNERSCENE_CATALOG_LICENSE")
    return catalog


def fixture_bytes(fixture_dir: Path, asset_id: str, suffix: str) -> bytes:
    return (fixture_dir / f"{asset_id}.{suffix}").read_bytes()


def inspect_asset(asset: dict[str, Any], fixture_dir: Path | None = None) -> dict[str, Any]:
    max_download_bytes = int(asset["max_download_bytes"])
    if fixture_dir is None:
        page_raw, page_http = fetch_bytes(asset["source_page"], MAX_SOURCE_PAGE_BYTES, "text/html")
        glb_raw, download_http = fetch_bytes(asset["download_url"], max_download_bytes, "application/octet-stream")
    else:
        page_raw = fixture_bytes(fixture_dir, asset["asset_id"], "html")
        glb_raw = fixture_bytes(fixture_dir, asset["asset_id"], "glb")
        page_http = {
            "url": asset["source_page"], "status": 200, "content_type": "text/html", "bytes": len(page_raw),
            "sha256": hashlib.sha256(page_raw).hexdigest(), "md5": hashlib.md5(page_raw).hexdigest(),
            "content_disposition": None, "content_length_header": str(len(page_raw)),
        }
        download_http = {
            "url": asset["download_url"], "status": 200, "content_type": "application/octet-stream", "bytes": len(glb_raw),
            "sha256": hashlib.sha256(glb_raw).hexdigest(), "md5": hashlib.md5(glb_raw).hexdigest(),
            "content_disposition": None, "content_length_header": str(len(glb_raw)),
        }
    if len(glb_raw) > max_download_bytes:
        raise RuntimeError(f"INNERSCENE_ASSET_EXCEEDS_CAP:{asset['asset_id']}:{len(glb_raw)}>{max_download_bytes}")

    page_text = page_raw.decode("utf-8", errors="replace")
    cc0_marker = "CC0" in page_text and ("Public domain" in page_text or "public domain" in page_text)
    if not cc0_marker:
        raise RuntimeError(f"INNERSCENE_CC0_MARKER_MISSING:{asset['asset_id']}")

    document, container = parse_glb(glb_raw)
    geometry = summarize_geometry(document)
    return {
        "asset_id": asset["asset_id"],
        "source_page": asset["source_page"],
        "download_url": asset["download_url"],
        "presentation_groups": asset["presentation_groups"],
        "nominal_height_m": asset["nominal_height_m"],
        "truth_guard": asset["truth_guard"],
        "status": "PASS",
        "license": {"cc0_marker_present": True, "page_http": page_http},
        "download": {**download_http, "max_download_bytes": max_download_bytes},
        "glb": {"container": container, "geometry": geometry, "asset_metadata": document.get("asset")},
    }


def build_inventory(fixture_dir: Path | None = None) -> dict[str, Any]:
    catalog = load_catalog()
    results = []
    for asset in catalog["assets"]:
        try:
            results.append(inspect_asset(asset, fixture_dir))
        except Exception as error:
            results.append({
                "asset_id": asset["asset_id"],
                "source_page": asset["source_page"],
                "download_url": asset["download_url"],
                "status": "FAIL",
                "error": repr(error),
            })
    return {
        "schema": "nwe.innerscene-tree-download-inventory/0.1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if all(item.get("status") == "PASS" for item in results) else "FAIL",
        "policy": {
            "downloads_bounded_candidate_glb_in_preprocessing": True,
            "raw_provider_bytes_retained": False,
            "raw_provider_bytes_committed": False,
            "runtime_provider_network_dependency": False,
        },
        "license": catalog["license"],
        "admission_policy": catalog["admission_policy"],
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
