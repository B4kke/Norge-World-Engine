from __future__ import annotations

from dataclasses import asdict, dataclass
import re
from typing import Mapping


class Dtm1EmbeddedMetadataError(RuntimeError):
    pass


_AUTHORITY_TERMS = ("buffer", "halo", "overlap", "core", "kartblad", "tile", "rute")
_DISCARD_TERMS = ("discard", "trim", "clip", "crop", "kast", "fjern")


@dataclass(frozen=True)
class EmbeddedMetadataAudit:
    namespaces_checked: int
    tag_count: int
    authority_term_hits: tuple[str, ...]
    discard_term_hits: tuple[str, ...]
    area_or_point: str | None
    explicit_border_discard_semantics: bool
    production_seam_authority: bool
    authority_status: str


def audit_embedded_metadata(namespaced_tags: Mapping[str, Mapping[str, str]]) -> dict:
    """Audit provider-embedded raster metadata without inventing seam semantics.

    Tag text is evidence only. A production border-discard rule requires an explicit
    statement that identifies border/core semantics *and* instructs that the border
    is to be trimmed/discarded. Generic GeoTIFF tags such as AREA_OR_POINT=Area,
    dimensions, timestamps or filenames are never sufficient.
    """
    if not namespaced_tags:
        raise Dtm1EmbeddedMetadataError("embedded metadata audit requires at least one namespace")

    flattened: list[str] = []
    tag_count = 0
    area_or_point = None
    for namespace, tags in sorted(namespaced_tags.items()):
        if not isinstance(tags, Mapping):
            raise Dtm1EmbeddedMetadataError(f"namespace {namespace!r} must map tag names to values")
        for key, value in sorted(tags.items()):
            tag_count += 1
            text = f"{namespace} {key} {value}".strip()
            flattened.append(text)
            if key.casefold() == "area_or_point":
                area_or_point = str(value)

    normalized = " ".join(flattened).casefold()
    authority_hits = tuple(term for term in _AUTHORITY_TERMS if re.search(rf"\b{re.escape(term)}\b", normalized))
    discard_hits = tuple(term for term in _DISCARD_TERMS if re.search(rf"\b{re.escape(term)}\b", normalized))

    # Even simultaneous keyword hits are not enough to authorize production: tags
    # can contain filenames/descriptions with ambiguous prose. The audit only
    # records whether explicit-looking semantics exist for provider review.
    explicit_border_discard = bool(authority_hits and discard_hits)
    audit = EmbeddedMetadataAudit(
        namespaces_checked=len(namespaced_tags),
        tag_count=tag_count,
        authority_term_hits=authority_hits,
        discard_term_hits=discard_hits,
        area_or_point=area_or_point,
        explicit_border_discard_semantics=explicit_border_discard,
        production_seam_authority=False,
        authority_status="UNPROVEN",
    )
    return {
        "schema": "nwe.dtm1-embedded-metadata-audit/0.1",
        "audit": asdict(audit),
        "claim_calibration": {
            "fact": "embedded GeoTIFF/GDAL metadata was inspected as a provider-carried evidence channel",
            "not_proven": "border discard, source priority, overlap winner, or production seam transform",
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
