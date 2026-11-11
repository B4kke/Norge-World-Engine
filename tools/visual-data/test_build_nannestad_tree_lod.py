#!/usr/bin/env python3
"""Offline source-gate and one-draw-call tree GLB regression."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path

import numpy as np
import trimesh

script = Path(__file__).with_name("build_nannestad_tree_lod.py")
spec = importlib.util.spec_from_file_location("tree_bake", script)
assert spec and spec.loader
baker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baker)


def make_source(height: float = 8.0) -> bytes:
    root = trimesh.Scene()
    stem = trimesh.creation.cone(radius=0.3, height=height * 0.7, sections=10)
    stem.apply_translation([0, 0, height * 0.35])
    # trimesh generates Z-up. Rotate +90deg around X to make Y-up GLB.
    stem.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    stem.visual.vertex_colors = [100, 75, 40, 255]
    crown = trimesh.creation.cone(radius=2.0, height=height * 0.9, sections=12)
    crown.apply_translation([0, 0, height * 0.55])
    crown.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    crown.visual.vertex_colors = [40, 100, 45, 255]
    root.add_geometry(stem, node_name="stem")
    root.add_geometry(crown, node_name="crown")
    return root.export(file_type="glb")


# Synthetic source fixtures test the compiler without provider calls.
source = make_source()
baker.SOURCE_BYTE_SIZE = len(source)
baker.SOURCE_SHA256 = hashlib.sha256(source).hexdigest()
page = b"<html>Public domain (CC0)</html>"
data, report = baker.bake(source, page)
assert report["status"] == "PASS"
assert report["source"]["mesh_count"] == 2
assert report["runtime"]["mesh_count"] == 1
assert report["runtime"]["byte_size"] == len(data)
assert report["runtime"]["triangles"] > 0
assert data[:4] == b"glTF"
assert report["runtime_provider_requests"] == 0
assert report["truth_guard"].find("NOT observed individual") > 0
scene = trimesh.load(io.BytesIO(data), file_type="glb", force="scene", process=False)
assert len(scene.dump()) == 1
bounds = np.asarray(scene.bounds)
assert abs(bounds[0, 1]) < 1e-4, "feet must rest at zero"
assert abs((bounds[1, 1] - bounds[0, 1]) - 8) < 1e-4
assert np.linalg.norm((bounds[0, [0, 2]] + bounds[1, [0, 2]]) / 2) < 1e-4

for tampered, licensing, expected in (
    (source + b"extra", page, "TREE_ASSET_PINNED_SOURCE_MISMATCH"),
    (source, b"ordinary model", "TREE_ASSET_LICENSE_NOT_VERIFIED"),
):
    try:
        baker.bake(tampered, licensing)
    except RuntimeError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError(f"admitted {expected}")

baker.SOURCE_BYTE_SIZE = len(make_source(20))
large = make_source(20)
baker.SOURCE_SHA256 = hashlib.sha256(large).hexdigest()
try:
    baker.bake(large, page)
except RuntimeError as error:
    assert "TREE_ASSET_HEIGHT_AXIS_INVALID" in str(error)
else:
    raise AssertionError("unbounded or wrong-axis tree admitted")

print("NANNESTAD_TREE_GLB_BAKE_PASS")
