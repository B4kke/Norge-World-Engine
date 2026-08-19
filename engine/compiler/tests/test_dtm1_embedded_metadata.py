import pytest

from nwe_compiler.dtm1_embedded_metadata import (
    Dtm1EmbeddedMetadataError,
    audit_embedded_metadata,
)


def test_generic_geotiff_metadata_never_authorizes_seam_policy():
    result = audit_embedded_metadata({
        "default": {"AREA_OR_POINT": "Area", "TIFFTAG_SOFTWARE": "GDAL"},
        "IMAGE_STRUCTURE": {"COMPRESSION": "DEFLATE"},
    })
    audit = result["audit"]
    assert audit["area_or_point"] == "Area"
    assert audit["production_seam_authority"] is False
    assert audit["authority_status"] == "UNPROVEN"


def test_filename_or_tile_word_is_not_border_authority():
    result = audit_embedded_metadata({"default": {"DESCRIPTION": "DTM1 tile 33-125-117"}})
    audit = result["audit"]
    assert "tile" in audit["authority_term_hits"]
    assert audit["explicit_border_discard_semantics"] is False
    assert audit["production_seam_authority"] is False


def test_explicit_looking_buffer_trim_text_is_flagged_but_not_promoted():
    result = audit_embedded_metadata({
        "default": {"DESCRIPTION": "5 m buffer around tile; trim buffer before mosaicking"}
    })
    audit = result["audit"]
    assert "buffer" in audit["authority_term_hits"]
    assert "trim" in audit["discard_term_hits"]
    assert audit["explicit_border_discard_semantics"] is True
    assert audit["production_seam_authority"] is False


def test_empty_metadata_fails_closed():
    with pytest.raises(Dtm1EmbeddedMetadataError):
        audit_embedded_metadata({})
