from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from html import unescape


class ProviderSourceScopeError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProviderSourceScope:
    nhm_project_coverage_selects_newest_for_original_laz: bool
    wcs_is_separate_national_dtm_source: bool
    wcs_resolution_m: float | None
    wcs_described_as_lower_accuracy: bool
    newest_project_authorizes_dtm1_overlap_priority: bool
    wcs_authorizes_dtm1_overlap_priority: bool
    production_seam_authority: bool
    authority_status: str


def _normalize_document_text(document_text: str) -> str:
    if not isinstance(document_text, str) or not document_text.strip():
        raise ProviderSourceScopeError("provider document must be non-empty text")
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", document_text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return " ".join(text.split()).casefold()


def classify_provider_source_scope(document_text: str) -> dict:
    """Classify only provider-owned source-selection statements with explicit scope.

    Kartverket's FYSAK documentation states that the NHM project-coverage overview
    is used to find the newest mapping project when the application reads original
    LAZ data from ``hoydedata_orig``. The same documentation presents the national
    DTM WCS as a separate 1 m raster source and says it is less accurate than the
    original-data path.

    Neither statement defines which valid sample wins where separately downloaded
    national DTM1 GeoTIFF route rasters overlap. This contract therefore keeps both
    tempting policies fail-closed.
    """

    text = _normalize_document_text(document_text)

    newest_original_laz = (
        "nhm-prosjektdekningsoversikten brukes for å finne nyeste kartleggingsprosjekt" in text
        and "hoydedata_orig" in text
        and "laz" in text
    )
    wcs_separate = (
        "wcs-tjenesten nasjonal høydemodell digital terrengmodell benyttes som datakilde" in text
        and "høyder fra wcs" in text
    )
    wcs_one_meter = (
        "wcs-tjenesten leverer en raster med oppløsningen 1x1 meter" in text
        or "wcs-tjenesten leverer en raster med 1 meters oppløsning" in text
    )
    wcs_lower_accuracy = (
        "vil gi lavere nøyaktighet" in text
        and "wcs" in text
    )

    scope = ProviderSourceScope(
        nhm_project_coverage_selects_newest_for_original_laz=newest_original_laz,
        wcs_is_separate_national_dtm_source=wcs_separate,
        wcs_resolution_m=1.0 if wcs_one_meter else None,
        wcs_described_as_lower_accuracy=wcs_lower_accuracy,
        newest_project_authorizes_dtm1_overlap_priority=False,
        wcs_authorizes_dtm1_overlap_priority=False,
        production_seam_authority=False,
        authority_status="UNPROVEN",
    )

    return {
        "schema": "nwe.dtm1-provider-source-scope/0.1",
        "scope": asdict(scope),
        "claim_calibration": {
            "fact": (
                "provider documentation scopes newest-project selection to the original-LAZ hoydedata_orig workflow and documents WCS as a separate national DTM raster source"
            ),
            "inference": (
                "neither newest-project ordering nor WCS composition may be imported as downloadable DTM1 GeoTIFF overlap authority without an explicit provider bridge"
            ),
            "not_proven": (
                "DTM1 tile border discard, 15 km authoritative sample domain, overlap winner, source priority, or production seam transform"
            ),
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
