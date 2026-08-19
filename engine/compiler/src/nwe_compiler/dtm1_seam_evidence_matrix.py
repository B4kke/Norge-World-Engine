from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable


class Dtm1SeamEvidenceError(RuntimeError):
    pass


@dataclass(frozen=True)
class SeamCandidateEvidence:
    candidate: str
    deterministic: bool
    provider_authorized: bool
    source_bound: bool
    discriminating_for_nannestad: bool
    provenance_fields: tuple[str, ...]
    blocker: str | None = None

    @property
    def production_eligible(self) -> bool:
        return (
            self.deterministic
            and self.provider_authorized
            and self.source_bound
            and self.discriminating_for_nannestad
            and bool(self.provenance_fields)
            and self.blocker is None
        )


def assess_seam_candidates(candidates: Iterable[SeamCandidateEvidence]) -> dict:
    """Classify DTM1 seam candidates without silently promoting a plausible rule.

    A production transform is eligible only when the provider semantics are
    explicit, bound to the actual DTM1 source family, deterministic for this
    seam, discriminating where a winner is required, and carry enough fields to
    become part of provenance/config identity.
    """
    items = tuple(candidates)
    if not items:
        raise Dtm1SeamEvidenceError("at least one seam candidate is required")

    names = [item.candidate for item in items]
    if len(set(names)) != len(names):
        raise Dtm1SeamEvidenceError("duplicate seam candidate")

    for item in items:
        if not item.candidate.strip():
            raise Dtm1SeamEvidenceError("candidate name must be non-empty")
        if item.provider_authorized and not item.source_bound:
            raise Dtm1SeamEvidenceError(
                f"{item.candidate}: provider authorization must be bound to the DTM1 source family"
            )
        if item.production_eligible and not item.provenance_fields:
            raise Dtm1SeamEvidenceError(
                f"{item.candidate}: production candidate lacks provenance fields"
            )

    eligible = [item for item in items if item.production_eligible]
    if len(eligible) > 1:
        raise Dtm1SeamEvidenceError("multiple production-eligible seam transforms are ambiguous")

    selected = eligible[0].candidate if len(eligible) == 1 else None
    return {
        "schema": "nwe.dtm1-seam-evidence-matrix/0.1",
        "candidates": [
            {
                **asdict(item),
                "production_eligible": item.production_eligible,
            }
            for item in items
        ],
        "selected_candidate": selected,
        "production_seam_authority": selected is not None,
        "authority_status": "PROVEN" if selected is not None else "UNPROVEN",
    }


def current_nannestad_seam_matrix() -> dict:
    """Encode only evidence already established for the Nannestad DTM1 seam."""
    return assess_seam_candidates(
        (
            SeamCandidateEvidence(
                candidate="symmetric_5px_core_clip",
                deterministic=True,
                provider_authorized=False,
                source_bound=True,
                discriminating_for_nannestad=True,
                provenance_fields=(
                    "provider_nominal_tile_size_m",
                    "raster_width_px",
                    "raster_height_px",
                    "pixel_size_m",
                ),
                blocker=(
                    "15 km + 15010 px geometry yields a unique symmetric 5 px core candidate, "
                    "but provider documentation has not authorized discarding the excess border"
                ),
            ),
            SeamCandidateEvidence(
                candidate="project_priority",
                deterministic=False,
                provider_authorized=False,
                source_bound=False,
                discriminating_for_nannestad=False,
                provenance_fields=("LAS_PROJECT_ID", "PRIORITET"),
                blocker=(
                    "all five mapped Nannestad project candidates advertise PRIORITET=1, and no "
                    "provider rule binds PRIORITET to national DTM1 overlap composition"
                ),
            ),
            SeamCandidateEvidence(
                candidate="newest_project",
                deterministic=True,
                provider_authorized=False,
                source_bound=False,
                discriminating_for_nannestad=True,
                provenance_fields=("LAS_PROJECT_ID", "SISTEFLYDATO"),
                blocker=(
                    "provider metadata documents newest-project semantics for hoydedata_orig/original-LAZ "
                    "and documents that the DTM WMS displays the latest project based on projects that "
                    "update NHM; neither statement is bound to downloadable national DTM1 GeoTIFF overlap"
                ),
            ),
            SeamCandidateEvidence(
                candidate="image_server_default_mosaic",
                deterministic=True,
                provider_authorized=False,
                source_bound=False,
                discriminating_for_nannestad=True,
                provenance_fields=("mosaic_method", "sort_field", "mosaic_operator"),
                blocker=(
                    "ImageServer publishes a presentation mosaic rule, but no provider contract makes "
                    "that rule authoritative for the SHA-addressed downloadable DTM1 GeoTIFFs"
                ),
            ),
            SeamCandidateEvidence(
                candidate="mean_min_max_tolerance_or_file_order",
                deterministic=False,
                provider_authorized=False,
                source_bound=False,
                discriminating_for_nannestad=False,
                provenance_fields=(),
                blocker="no provider evidence authorizes these synthetic winner policies",
            ),
        )
    )
