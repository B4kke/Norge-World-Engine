#!/usr/bin/env python3
"""Reproducible CC0 conifer -> 1-draw-call color-baked GLB, offline preprocessing.

Source tree is a generic visual exemplar, NOT an observed individual Norway tree.
No raw asset is committed; only a byte-pinned derivative enters the replaceable
runtime package. The browser NEVER fetches an asset-provider URL.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import trimesh

from inventory_innerscene_tree_assets import parse_glb, summarize_geometry

ASSET_ID = "conifer_light"
SOURCE_PAGE = "https://www.innerscene.com/tools/library/3d-parts/conifer-light-sprays-1014156d"
SOURCE_URL = "https://files.innerscene.com/library/conifer-light-sprays-1014156d/b6696b1f65a58e91f7c0/conifer-light.glb"
SOURCE_SHA256 = "812f691eb68119681038aed7f45dd80bff0a152afe1fc8160ea5cbeeae9143da"
SOURCE_BYTE_SIZE = 517112
NOMINAL_HEIGHT_M = 8.0
MAX_SOURCE_MESHES = 400
MAX_SOURCE_TRIANGLES = 12000
MAX_DERIVED_BYTES = 700000
USER_AGENT = "NorgeWorldEngine-TreeBaker/0.1 (+https://github.com/B4kke/Norge-World-Engine)"


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def fetch_checked(url: str, cap: int, host: str) -> bytes:
    if urlparse(url).scheme != "https" or urlparse(url).hostname != host:
        raise RuntimeError("TREE_ASSET_SOURCE_URL_NOT_ALLOWED")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=45) as response:
        if (urlparse(response.geturl()).scheme, urlparse(response.geturl()).hostname) != ("https", host):
            raise RuntimeError("TREE_ASSET_REDIRECT_NOT_ALLOWED")
        if int(response.headers.get("Content-Length", 0)) > cap:
            raise RuntimeError("TREE_ASSET_SOURCE_CAP_EXCEEDED")
        data = response.read(cap + 1)
    if len(data) > cap:
        raise RuntimeError("TREE_ASSET_SOURCE_CAP_EXCEEDED")
    return data


def validate_source(raw: bytes, page_html: bytes) -> dict:
    if len(raw) != SOURCE_BYTE_SIZE or sha256(raw) != SOURCE_SHA256:
        raise RuntimeError("TREE_ASSET_PINNED_SOURCE_MISMATCH")
    if not (b"CC0" in page_html and b"Public domain" in page_html):
        raise RuntimeError("TREE_ASSET_LICENSE_NOT_VERIFIED")
    doc, _ = parse_glb(raw)
    stats = summarize_geometry(doc)
    if not (1 <= stats["mesh_count"] <= MAX_SOURCE_MESHES):
        raise RuntimeError("TREE_ASSET_MESH_BUDGET_EXCEEDED")
    if not (1 <= stats["triangle_estimate"] <= MAX_SOURCE_TRIANGLES):
        raise RuntimeError("TREE_ASSET_TRIANGLE_BUDGET_EXCEEDED")
    if stats["texture_count"] != 0 or stats["image_count"] != 0:
        raise RuntimeError("TREE_ASSET_UNEXPECTED_TEXTURE_CLOSURE")
    if doc.get("asset", {}).get("version") != "2.0":
        raise RuntimeError("TREE_ASSET_SOURCE_NOT_GLTF2")
    return stats


def bake(raw: bytes, page_html: bytes) -> tuple[bytes, dict]:
    source = validate_source(raw, page_html)
    scene = trimesh.load(io.BytesIO(raw), file_type="glb", force="scene", process=False)
    parts = scene.dump(concatenate=False)
    if not (1 <= len(parts) <= MAX_SOURCE_MESHES):
        raise RuntimeError("TREE_ASSET_SOURCE_INSTANCE_COUNT_INVALID")
    normalized = []
    for part in parts:
        if not isinstance(part, trimesh.Trimesh) or part.is_empty:
            raise RuntimeError("TREE_ASSET_NONTRIANGLE_PART")
        copy = part.copy()
        if copy.visual.kind == "texture":
            # The provider uses untextured PBR materials: bake each source
            # material's main color explicitly, not the generic trimesh
            # fallback that may produce uniform mid-gray after export.
            color = np.asarray(copy.visual.material.main_color, dtype=np.uint8)
            if color.shape != (4,):
                raise RuntimeError("TREE_ASSET_SOURCE_MATERIAL_COLOR_INVALID")
            copy.visual = trimesh.visual.ColorVisuals(
                mesh=copy, vertex_colors=np.tile(color, (len(copy.vertices), 1)),
            )
        if copy.visual.kind != "vertex":
            raise RuntimeError("TREE_ASSET_MATERIAL_CANNOT_BAKE_VERTEX_COLOR")
        if not np.isfinite(copy.vertices).all():
            raise RuntimeError("TREE_ASSET_VERTEX_NOT_FINITE")
        normalized.append(copy)
    # trimesh.util.concatenate may drop the visual payload when the source
    # includes hundreds of separately materialized nodes. Preserve the
    # per-vertex colors by joining the mesh buffers explicitly, in order.
    colors = np.concatenate([np.asarray(part.visual.vertex_colors, dtype=np.uint8) for part in normalized], axis=0)
    vertices = np.concatenate([np.asarray(part.vertices) for part in normalized], axis=0)
    face_chunks = []
    base = 0
    for part in normalized:
        face_chunks.append(np.asarray(part.faces, dtype=np.int64) + base)
        base += len(part.vertices)
    faces = np.concatenate(face_chunks, axis=0)
    if colors.shape != (len(vertices), 4) or len(np.unique(colors[:, :3], axis=0)) < 2:
        raise RuntimeError("TREE_ASSET_SOURCE_MATERIAL_COLORS_LOST:"
                           + json.dumps({"colors": np.unique(colors[:, :3], axis=0).tolist()[:8],
                                         "source_materials": doc.get("materials", [])}, default=str)[:1200])
    merged = trimesh.Trimesh(vertices=vertices, faces=faces,
                            vertex_colors=colors, process=False)
    original_bounds = np.asarray(merged.bounds)
    if not np.isfinite(original_bounds).all():
        raise RuntimeError("TREE_ASSET_INVALID_BOUNDS")
    height = float(original_bounds[1, 1] - original_bounds[0, 1])
    if not 7.5 <= height <= 8.5:
        raise RuntimeError(f"TREE_ASSET_HEIGHT_AXIS_INVALID:{height:.3f}")
    if len(merged.faces) > MAX_SOURCE_TRIANGLES or len(merged.faces) < 100:
        raise RuntimeError("TREE_ASSET_DERIVED_TRIANGLE_BUDGET")
    merged.apply_translation([
        -(original_bounds[0, 0] + original_bounds[1, 0]) / 2,
        -original_bounds[0, 1],
        -(original_bounds[0, 2] + original_bounds[1, 2]) / 2,
    ])
    compiled = merged.export(file_type="glb")
    if len(compiled) > MAX_DERIVED_BYTES:
        raise RuntimeError("TREE_ASSET_DERIVED_SIZE_BUDGET")
    document, _ = parse_glb(compiled)
    geometry = summarize_geometry(document)
    if geometry["mesh_count"] != 1 or geometry["texture_count"] != 0:
        raise RuntimeError("TREE_ASSET_NOT_BAKED_TO_SINGLE_MESH")
    primitive = document["meshes"][0]["primitives"][0]
    if "COLOR_0" not in primitive.get("attributes", {}):
        raise RuntimeError("TREE_ASSET_DERIVED_VERTEX_COLORS_MISSING")
    if geometry["triangle_estimate"] != len(merged.faces):
        raise RuntimeError("TREE_ASSET_DERIVED_TRIANGLE_IDENTITY")
    report = {
        "schema": "nwe.tree-presentation-asset/0.1",
        "status": "PASS",
        "tile_id": "epsg25832_611000_6677000_1000m",
        "asset_id": ASSET_ID,
        "source": {"url": SOURCE_URL, "page": SOURCE_PAGE, "sha256": SOURCE_SHA256,
                   "byte_size": len(raw), "mesh_count": source["mesh_count"],
                   "triangles": source["triangle_estimate"], "license": "CC0-1.0"},
        "runtime": {"sha256": sha256(compiled), "byte_size": len(compiled),
                    "mesh_count": geometry["mesh_count"], "triangles": geometry["triangle_estimate"],
                    "vertices": geometry["total_vertices"], "nominal_height_m": height,
                    "max_near_instances": 36, "near_radius_m": 125.0},
        "truth_guard": "generic CC0 conifer model placed at source-derived SR16 representative points; NOT observed individual trees",
        "bake": "trimesh-flatten-transforms-explicit-color0-bake-1mesh-centerXZ-groundY-v0.2",
        "distinct_material_colors": len(np.unique(colors[:, :3], axis=0)),
        "runtime_provider_requests": 0,
    }
    return compiled, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-glb", type=Path, required=True)
    parser.add_argument("--output-report", type=Path, required=True)
    args = parser.parse_args()
    raw = fetch_checked(SOURCE_URL, SOURCE_BYTE_SIZE, "files.innerscene.com")
    page = fetch_checked(SOURCE_PAGE, 1024 * 1024, "www.innerscene.com")
    compiled, report = bake(raw, page)
    args.output_glb.parent.mkdir(parents=True, exist_ok=True)
    args.output_report.parent.mkdir(parents=True, exist_ok=True)
    args.output_glb.write_bytes(compiled)
    args.output_report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": report["status"], "source_sha256": SOURCE_SHA256,
                      "runtime_sha256": report["runtime"]["sha256"],
                      "runtime_bytes": report["runtime"]["byte_size"],
                      "runtime_triangles": report["runtime"]["triangles"]}))


if __name__ == "__main__":
    main()
