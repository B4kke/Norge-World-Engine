import io
import json
import zipfile
from pathlib import Path

import pytest

from materialize_svv_sign_artwork import infer_sign_code, materialize, normalize_provider_code


def write_fake_zip(path: Path) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("202_0.jpg", b"jpeg-202")
        archive.writestr("206_0.jpg", b"jpeg-206")
        archive.writestr("214_0.jpg", b"jpeg-214")
    path.write_bytes(buffer.getvalue())


def test_normalization() -> None:
    assert normalize_provider_code("202_0") == "202"
    assert normalize_provider_code("362_50") == "362.50"
    assert infer_sign_code("folder/206_0.jpg") == "206"


def test_materialize_exact_mapping(tmp_path: Path) -> None:
    archive = tmp_path / "source.zip"
    write_fake_zip(archive)
    output = tmp_path / "runtime"
    manifest = materialize(
        archive,
        output,
        ["202", "206"],
        family="vikeplikt",
        source_url="https://example.invalid/vikeplikt.zip",
    )
    assert manifest["status"] == "PASS"
    assert manifest["requested_sign_codes"] == ["202", "206"]
    assert [asset["sign_code"] for asset in manifest["assets"]] == ["202", "206"]
    assert (output / "202.jpg").read_bytes() == b"jpeg-202"
    assert (output / "206.jpg").read_bytes() == b"jpeg-206"
    persisted = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    assert persisted["source_archive_sha256"] == manifest["source_archive_sha256"]
    assert all(len(asset["sha256"]) == 64 for asset in persisted["assets"])


def test_missing_code_fails_closed(tmp_path: Path) -> None:
    archive = tmp_path / "source.zip"
    write_fake_zip(archive)
    with pytest.raises(RuntimeError, match="SVV_SIGN_CODES_UNRESOLVED:208"):
        materialize(
            archive,
            tmp_path / "runtime",
            ["208"],
            family="vikeplikt",
            source_url="https://example.invalid/vikeplikt.zip",
        )
