from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).with_name("stage_preview1_snapshot.py")
spec = importlib.util.spec_from_file_location("stage_preview1_snapshot", MODULE_PATH)
assert spec and spec.loader
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


def bundle(reference: str, *, sha256: str = "a" * 64, byte_size: int = 3) -> dict:
    return {
        "artifact_ref": {
            "schema": "nwe.artifact-ref/0.1",
            "artifact_role": "road-network",
            "sha256": sha256,
            "byte_size": byte_size,
            "media_type": "application/json",
            "transport": {"reference": reference},
        }
    }


def test_compiled_relative_accepts_only_safe_compiled_cache_paths() -> None:
    value = bundle("cache://compiled/epsg25832_tile/road-network/abc.json")
    assert stage.compiled_relative(value).as_posix() == "epsg25832_tile/road-network/abc.json"


@pytest.mark.parametrize(
    "reference",
    [
        "https://api.nvdb.no/v4/vegobjekter",
        "cache://compiled/../raw.json",
        "cache://compiled/epsg25832_tile/../../raw.json",
        "cache://compiled/",
        "https://example.test/compiled/artifact.json",
    ],
)
def test_compiled_relative_rejects_raw_or_unsafe_transport(reference: str) -> None:
    with pytest.raises(RuntimeError):
        stage.compiled_relative(bundle(reference))


def test_copy_runtime_pair_requires_content_identity(tmp_path: Path) -> None:
    artifact = tmp_path / "artifact.json"
    artifact.write_bytes(b"abc")
    good_sha = stage.sha256_file(artifact)
    bundle_path = tmp_path / "bundle.json"
    bundle_path.write_text(
        json.dumps(bundle("cache://compiled/tile/road-network/abc.json", sha256=good_sha, byte_size=3)),
        encoding="utf-8",
    )
    output = tmp_path / "out"
    copied = stage.copy_runtime_pair(
        bundle_path=bundle_path,
        artifact_path=artifact,
        output=output,
        bundle_name="roads.bundle.json",
    )
    assert copied["artifact_sha256"] == good_sha
    assert (output / "compiled/tile/road-network/abc.json").read_bytes() == b"abc"

    artifact.write_bytes(b"abd")
    with pytest.raises(RuntimeError, match="SHA mismatch"):
        stage.copy_runtime_pair(
            bundle_path=bundle_path,
            artifact_path=artifact,
            output=output,
            bundle_name="roads.bundle.json",
        )
