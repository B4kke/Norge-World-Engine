from __future__ import annotations

from dataclasses import asdict, dataclass


class Dtm1NhmUpdateScopeError(RuntimeError):
    pass


@dataclass(frozen=True)
class NhmUpdateSurfaceEvidence:
    provider: str
    surface: str
    states_latest_project_displayed: bool
    latest_project_basis: str | None
    states_projects_update_nhm: bool
    downloadable_dtm1_source_bound: bool
    explicit_dtm1_overlap_rule: bool
    provenance_fields: tuple[str, ...]


def classify_nhm_update_surface(evidence: NhmUpdateSurfaceEvidence) -> dict:
    """Classify provider NHM update/display semantics without promoting them to DTM1 authority.

    The public DTM WMS can document how its displayed national model relates to
    projects that update NHM. That is useful provider semantics, but it is not a
    downloadable-DTM1 overlap rule unless the provider explicitly binds the same
    rule to the GeoTIFF source family and defines the overlap transform.
    """
    if not evidence.provider.strip():
        raise Dtm1NhmUpdateScopeError("provider must be non-empty")
    if not evidence.surface.strip():
        raise Dtm1NhmUpdateScopeError("surface must be non-empty")
    if evidence.states_latest_project_displayed and not evidence.latest_project_basis:
        raise Dtm1NhmUpdateScopeError("latest-project display semantics require an explicit basis")
    if evidence.explicit_dtm1_overlap_rule and not evidence.downloadable_dtm1_source_bound:
        raise Dtm1NhmUpdateScopeError(
            "DTM1 overlap authority cannot be claimed without downloadable-DTM1 source binding"
        )
    if evidence.downloadable_dtm1_source_bound and not evidence.provenance_fields:
        raise Dtm1NhmUpdateScopeError("source-bound DTM1 evidence requires provenance fields")

    nhm_update_semantics_supported = (
        evidence.states_latest_project_displayed
        and evidence.states_projects_update_nhm
        and bool(evidence.latest_project_basis)
    )
    production_authority = (
        nhm_update_semantics_supported
        and evidence.downloadable_dtm1_source_bound
        and evidence.explicit_dtm1_overlap_rule
        and bool(evidence.provenance_fields)
    )

    return {
        "schema": "nwe.dtm1-nhm-update-scope/0.1",
        "evidence": asdict(evidence),
        "nhm_update_semantics_supported": nhm_update_semantics_supported,
        "authorizes_downloadable_dtm1_overlap": production_authority,
        "production_seam_authority": production_authority,
        "authority_status": "PROVEN" if production_authority else "UNPROVEN",
    }


def current_provider_dtm_wms_scope() -> dict:
    """Encode the current provider-published DTM WMS update/display statement.

    Provider metadata states that the latest project is displayed based on which
    projects update the national height model. The metadata does not bind that
    WMS display rule to the separately downloadable DTM1 GeoTIFF overlap.
    """
    return classify_nhm_update_surface(
        NhmUpdateSurfaceEvidence(
            provider="Statens kartverk",
            surface="Digital terrengmodell WMS / wms.hoyde-dtm",
            states_latest_project_displayed=True,
            latest_project_basis="projects_that_update_national_height_model",
            states_projects_update_nhm=True,
            downloadable_dtm1_source_bound=False,
            explicit_dtm1_overlap_rule=False,
            provenance_fields=(
                "provider",
                "surface",
                "latest_project_basis",
                "provider_metadata_snapshot_sha256",
            ),
        )
    )
