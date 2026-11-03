import io
import zipfile

from probe_svv_sign_artwork import infer_sign_code, inspect_archive


def fake_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("Vikeplikt/202.jpg", b"fake-jpeg")
        archive.writestr("Vikeplikt/206_1.png", b"fake-png")
        archive.writestr("README.txt", b"metadata")
    return buffer.getvalue()


def test_code_inference() -> None:
    assert infer_sign_code("202.jpg") == "202"
    assert infer_sign_code("206_1.png") == "206.1"
    assert infer_sign_code("README.txt") is None


def test_archive_inspection() -> None:
    result = inspect_archive(fake_zip(), family="vikeplikt", url="https://example.invalid/vikeplikt.zip")
    assert result["status"] == "PASS"
    assert result["file_count"] == 3
    assert result["image_file_count"] == 2
    assert result["inferred_sign_code_count"] == 2
    assert result["license_profile"] == "NLOD-1.0"
    assert result["inferred_sign_codes"]["202"] == ["Vikeplikt/202.jpg"]
    assert "runtime" in result["policy"]
