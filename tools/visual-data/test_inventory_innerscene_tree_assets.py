#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import struct
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("inventory_innerscene_tree_assets.py")
spec = importlib.util.spec_from_file_location("innerscene_inventory", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def pad4(raw: bytes, fill: bytes) -> bytes:
    return raw + fill * ((4 - len(raw) % 4) % 4)


def make_glb() -> bytes:
    document = {
        "asset": {"version": "2.0", "generator": "fixture"},
        "buffers": [{"byteLength": 16}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 16}],
        "accessors": [
            {"bufferView": 0, "count": 120, "componentType": 5126, "type": "VEC3"},
            {"bufferView": 0, "count": 300, "componentType": 5123, "type": "SCALAR"},
        ],
        "materials": [{"name": "foliage"}],
        "textures": [],
        "images": [],
        "meshes": [{"name": "tree", "primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "material": 0}]}],
        "nodes": [{"mesh": 0}],
    }
    json_chunk = pad4(json.dumps(document, separators=(",", ":")).encode("utf-8"), b" ")
    bin_chunk = pad4(b"fixture-binary", b"\x00")
    body = struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk
    body += struct.pack("<I4s", len(bin_chunk), b"BIN\x00") + bin_chunk
    return struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body


raw = make_glb()
document, container = module.parse_glb(raw)
assert container["version"] == 2
assert container["declared_length"] == len(raw)
assert container["has_bin_chunk"] is True
geometry = module.summarize_geometry(document)
assert geometry["mesh_count"] == 1
assert geometry["primitive_count"] == 1
assert geometry["total_vertices"] == 120
assert geometry["total_indices"] == 300
assert geometry["triangle_estimate"] == 100
assert geometry["material_count"] == 1

try:
    module.parse_glb(b"BAD!" + raw[4:])
except ValueError as error:
    assert "GLB_MAGIC" in str(error)
else:
    raise AssertionError("bad GLB magic was accepted")

with tempfile.TemporaryDirectory() as temp:
    fixtures = Path(temp)
    catalog = module.load_catalog()
    for asset in catalog["assets"]:
        (fixtures / f"{asset['asset_id']}.html").write_text(
            "<html><body>Public domain (CC0). Free to use and redistribute.</body></html>",
            encoding="utf-8",
        )
        (fixtures / f"{asset['asset_id']}.glb").write_bytes(raw)
    report = module.build_inventory(fixtures)
    assert report["status"] == "PASS"
    assert report["policy"]["raw_provider_bytes_retained"] is False
    assert report["policy"]["runtime_provider_network_dependency"] is False
    assert len(report["assets"]) == 5
    for asset in report["assets"]:
        assert asset["license"]["cc0_marker_present"] is True
        assert asset["download"]["sha256"]
        assert asset["glb"]["geometry"]["triangle_estimate"] == 100

    first = catalog["assets"][0]
    (fixtures / f"{first['asset_id']}.html").write_text("<html>no license marker</html>", encoding="utf-8")
    try:
        module.inspect_asset(first, fixtures)
    except RuntimeError as error:
        assert "CC0_MARKER_MISSING" in str(error)
    else:
        raise AssertionError("missing CC0 marker was accepted")

print("Innerscene tree inventory regressions: PASS")
