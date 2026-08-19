from __future__ import annotations

from dataclasses import asdict, dataclass


class Dtm1NhmPackagingContractError(RuntimeError):
    pass


@dataclass(frozen=True)
class NhmPackagingEvidence:
    national_model_described_as_projects_stitched_together: bool
    export_supports_map_sheet_clipping: bool
    dtm1_download_described_as_map_sheet_grouped: bool
    nhm_metadata_contains_map_sheet_divisions: bool
    nhm_metadata_contains_projects_used_to_generate_model: bool
    packaging_semantics_supported: bool
    authorizes_overscan_discard: bool
    authorizes_overlap_winner: bool
    production_seam_authority: bool
    authority_status: str


def assess_nhm_packaging_semantics(
    *,
    national_model_described_as_projects_stitched_together: bool,
    export_supports_map_sheet_clipping: bool,
    dtm1_download_described_as_map_sheet_grouped: bool,
    nhm_metadata_contains_map_sheet_divisions: bool,
    nhm_metadata_contains_projects_used_to_generate_model: bool,
) -> dict:
    """Classify provider-owned NHM packaging semantics without inventing a seam rule.

    Høydedata's public help separates the national model from file packaging: it
    describes the national height model as current projects stitched together,
    documents map-sheet clipping as a file-division option, and separately says
    DTM1 downloads are grouped from nearby map sheets while NHM metadata carries
    both map-sheet divisions and metadata for projects used to generate NHM.

    These facts support treating downloadable DTM1 tiles as packaging units of a
    generated national model. They do *not* state that the measured five-pixel
    border is disposable, nor which value wins where two packaged GeoTIFFs
    overlap. Production mosaicking therefore remains fail-closed.
    """
    values = (
        national_model_described_as_projects_stitched_together,
        export_supports_map_sheet_clipping,
        dtm1_download_described_as_map_sheet_grouped,
        nhm_metadata_contains_map_sheet_divisions,
        nhm_metadata_contains_projects_used_to_generate_model,
    )
    if any(type(value) is not bool for value in values):
        raise Dtm1NhmPackagingContractError("provider evidence flags must be booleans")

    packaging_supported = all(values)
    evidence = NhmPackagingEvidence(
        national_model_described_as_projects_stitched_together=values[0],
        export_supports_map_sheet_clipping=values[1],
        dtm1_download_described_as_map_sheet_grouped=values[2],
        nhm_metadata_contains_map_sheet_divisions=values[3],
        nhm_metadata_contains_projects_used_to_generate_model=values[4],
        packaging_semantics_supported=packaging_supported,
        authorizes_overscan_discard=False,
        authorizes_overlap_winner=False,
        production_seam_authority=False,
        authority_status="UNPROVEN",
    )
    return {
        "schema": "nwe.dtm1-nhm-packaging-contract/0.1",
        "evidence": asdict(evidence),
        "claim_calibration": {
            "fact": (
                "provider documentation supports a generated national-model plus map-sheet packaging boundary"
                if packaging_supported
                else "provider documentation is incomplete for the national-model packaging boundary"
            ),
            "inference": "the observed raster excess may be packaging/export overscan",
            "not_proven": "five-pixel border discard, overlap winner, or production seam transform",
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
