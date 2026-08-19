from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from html import unescape


class ProviderSemanticsError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProviderSemantics:
    pointcloud_is_primary_dataset: bool
    products_are_derived_automatically: bool
    national_grid_artifacts_are_explicitly_possible: bool
    dtm_generation_method_documented: bool
    nlod_license_documented: bool
    production_seam_authority: bool
    authority_status: str


def _normalize_document_text(document_text: str) -> str:
    if not isinstance(document_text, str) or not document_text.strip():
        raise ProviderSemanticsError("provider document must be non-empty text")
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", document_text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return " ".join(text.split()).casefold()


def classify_provider_semantics(document_text: str) -> dict:
    """Extract only provider statements that are strong enough to carry provenance.

    This classifier deliberately does not infer a terrain seam winner. The official
    Høydedata product specification can establish primary-vs-derived product
    semantics and warn about derived-grid artefacts without defining which valid
    sample wins where downloadable DTM1 rasters overlap.
    """

    text = _normalize_document_text(document_text)

    pointcloud_is_primary = "primærdatasettet i fvl er punktskyen" in text
    products_derived = "alle produkt avledes fra denne automatisk" in text
    national_grid_artifacts = "artefakter i prosjektgrid og i nasjonale grid" in text
    dtm_method = (
        "triangulate with natural neighbor interpolation" in text
        and "bin with average value" in text
    )
    nlod_license = (
        "norsk lisens for offentlige data" in text
        or "nlod" in text
    )

    semantics = ProviderSemantics(
        pointcloud_is_primary_dataset=pointcloud_is_primary,
        products_are_derived_automatically=products_derived,
        national_grid_artifacts_are_explicitly_possible=national_grid_artifacts,
        dtm_generation_method_documented=dtm_method,
        nlod_license_documented=nlod_license,
        production_seam_authority=False,
        authority_status="UNPROVEN",
    )

    return {
        "schema": "nwe.dtm1-provider-semantics/0.1",
        "semantics": asdict(semantics),
        "claim_calibration": {
            "fact": (
                "provider documentation can establish primary point-cloud and derived-grid semantics"
            ),
            "inference": (
                "a downloadable derived-grid overlap must not be promoted to an implicit source-priority rule"
            ),
            "not_proven": (
                "15 km authoritative core, disposable halo, overlap winner, sample clipping rule, or production seam transform"
            ),
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
