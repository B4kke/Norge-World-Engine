"""Negative/positive immutable world-transport tests; no network required."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

HERE = Path(__file__).parent


def load(name: str):
    path = HERE / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


accepted = load("accepted_world_snapshot")
stager = load("stage_preview1_snapshot")


def fixture_data(monkeypatch):
    originals = {
        "terrain": ("terrain-height-grid", b"nwehgt bytes", "nwehgt"),
        "roads": ("road-network", b'{"paths":[]}', "json"),
        "buildings": ("building-footprints", b'{"features":[]}', "json"),
    }
    hashes = {
        name: (role, hashlib.sha256(blob).hexdigest(), len(blob), extension)
        for name, (role, blob, extension) in originals.items()
    }
    monkeypatch.setattr(accepted, "ACCEPTED_ASSETS", hashes)
    manifest = {
        "schema": "nwe.world-preview-manifest/0.1",
        "status": "REAL_COMPILED_WITH_DERIVED_REALISM",
        "generated_from_commit": accepted.PRODUCER_COMMIT,
        "tile": {
            "id": accepted.TILE_ID,
            "horizontal_crs": "EPSG:25832",
            "vertical_datum": "NN2000",
            "bounds": [611000., 6677000., 612000., 6678000.],
        },
    }
    responses = {}
    for name, (role, blob, _) in originals.items():
        _, sha, size, _ = hashes[name]
        manifest[name] = {
            "artifact_role": role,
            "artifact_sha256": sha,
            "artifact_byte_size": size,
            "bundle": f"./{accepted.accepted_path(name, 'bundle')}",
            "compiled_path": f"./{accepted.accepted_path(name, 'artifact')}",
            "compiled_count": 135 if name == "buildings" else 1,
            "raw_sha256": "1" * 64,
        }
        responses[f"{accepted.BASE_URL}/{accepted.accepted_path(name, 'artifact')}"] = blob
        ref = {
            "sha256": sha,
            "byte_size": size,
            "artifact_role": role,
            "tile_id": accepted.TILE_ID,
            "transport": {"reference": f"cache://compiled/{accepted.accepted_path(name, 'artifact')}"},
        }
        bundle = {"artifact_ref": ref, "artifact_ref_hash": "hash", "compile_lineage": {"schema": "nwe.compile-lineage/0.1"}}
        responses[f"{accepted.BASE_URL}/{accepted.accepted_path(name, 'bundle')}"] = json.dumps(bundle).encode()
    responses[f"{accepted.BASE_URL}/manifest.json"] = json.dumps(manifest).encode()
    return manifest, responses


def test_immutable_accepted_base_stages_exact_three_layers(monkeypatch, tmp_path: Path) -> None:
    manifest, responses = fixture_data(monkeypatch)
    urls = []
    def download(url: str) -> bytes:
        urls.append(url)
        return responses[url]
    header, terrain, layers = accepted.stage_accepted_base(tmp_path, download, stager.copy_runtime_pair)
    assert header["tile_id"] == accepted.TILE_ID
    assert header["vertical_datum"] == "NN2000"
    assert terrain["artifact_sha256"] == manifest["terrain"]["artifact_sha256"]
    assert layers["roads"]["artifact_sha256"] == manifest["roads"]["artifact_sha256"]
    assert layers["buildings"]["artifact_sha256"] == manifest["buildings"]["artifact_sha256"]
    for name in ("terrain", "roads", "buildings"):
        assert (tmp_path / accepted.accepted_path(name, "artifact")).exists()
        assert (tmp_path / accepted.accepted_path(name, "bundle")).exists()
    assert len(urls) == 7
    assert all(url.startswith(f"{accepted.BASE_URL}/") for url in urls)
    assert not any("kartverket" in url or "overpass" in url for url in urls)


def test_rejects_tampering_and_different_source_epoch(monkeypatch, tmp_path: Path) -> None:
    manifest, responses = fixture_data(monkeypatch)
    tampered = json.loads(json.dumps(manifest))
    tampered["buildings"]["artifact_sha256"] = "0" * 64
    with pytest.raises(RuntimeError, match="immutable artifact identity"):
        accepted.verify_accepted_manifest(tampered)
    tampered = json.loads(json.dumps(manifest))
    tampered["generated_from_commit"] = "0" * 40
    with pytest.raises(RuntimeError, match="producer identity"):
        accepted.verify_accepted_manifest(tampered)
    tampered = json.loads(json.dumps(manifest))
    tampered["terrain"]["compiled_path"] = "./compiled/../../evil"
    with pytest.raises(RuntimeError, match="unexpected compiled path"):
        accepted.verify_accepted_manifest(tampered)
    responses[f"{accepted.BASE_URL}/{accepted.accepted_path('buildings', 'artifact')}"] = b"wrong byte contents"
    with pytest.raises(RuntimeError, match="immutable bytes mismatch"):
        accepted.stage_accepted_base(tmp_path, lambda url: responses[url], stager.copy_runtime_pair)
    # The actual normalized source is never automatically replaced by a newer
    # but incompatible OSM/height candidate.


def test_runtime_bundle_metadata_is_not_optional(monkeypatch, tmp_path: Path) -> None:
    _, responses = fixture_data(monkeypatch)
    url = f"{accepted.BASE_URL}/{accepted.accepted_path('buildings', 'bundle')}"
    bundle = json.loads(responses[url])
    del bundle["compile_lineage"]
    responses[url] = json.dumps(bundle).encode()
    with pytest.raises(RuntimeError, match="incomplete provenance bundle"):
        accepted.stage_accepted_base(tmp_path, lambda url: responses[url], stager.copy_runtime_pair)
