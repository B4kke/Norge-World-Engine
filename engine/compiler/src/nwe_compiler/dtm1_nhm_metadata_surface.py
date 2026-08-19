from __future__ import annotations

from dataclasses import asdict, dataclass


class Dtm1NhmMetadataSurfaceError(RuntimeError):
    pass


_REQUIRED_LAYERS = frozenset(
    {
        "NHM prosjektdekning",
        "NHM prosjektalder",
        "prioritet 1",
        "prioritet 2",
        "prioritet 3",
        "Prosjekttype",
    }
)


@dataclass(frozen=True)
class NhmMetadataSurfaceEvidence:
    machine_readable_project_metadata_service: bool
    nhm_project_coverage_layer: bool
    nhm_project_age_layer: bool
    priority_layers_present: bool
    project_type_layer: bool
    candidate_priority_metadata_present: bool
    priority_semantics_documented_for_dtm1_seams: bool
    authorizes_overlap_winner: bool
    production_seam_authority: bool
    authority_status: str


def assess_nhm_metadata_surface(
    *,
    service_is_machine_readable_project_metadata: bool,
    advertised_layers: set[str] | frozenset[str],
    priority_semantics_documented_for_dtm1_seams: bool = False,
) -> dict:
    """Classify provider NHM metadata as evidence, never implicit seam authority.

    Kartverket's public metadata-service registry advertises a WFS for projects in
    hoydedata.no with NHM project coverage/age plus priority 1/2/3 layers.  Those
    names make the service a high-value source for project-selection provenance.
    They do not by themselves define what the priority classes mean for national
    DTM1 raster generation or which sample wins inside a packaged GeoTIFF overlap.
    """
    if type(service_is_machine_readable_project_metadata) is not bool:
        raise Dtm1NhmMetadataSurfaceError("service evidence flag must be boolean")
    if type(priority_semantics_documented_for_dtm1_seams) is not bool:
        raise Dtm1NhmMetadataSurfaceError("priority semantics flag must be boolean")
    if not isinstance(advertised_layers, (set, frozenset)) or any(
        not isinstance(name, str) or not name.strip() for name in advertised_layers
    ):
        raise Dtm1NhmMetadataSurfaceError("advertised_layers must be a set of non-empty strings")

    layers = frozenset(name.strip() for name in advertised_layers)
    missing = sorted(_REQUIRED_LAYERS - layers)
    if missing:
        raise Dtm1NhmMetadataSurfaceError(
            "provider metadata surface is incomplete; missing: " + ", ".join(missing)
        )

    priority_layers_present = {"prioritet 1", "prioritet 2", "prioritet 3"}.issubset(layers)
    candidate_priority_metadata_present = (
        service_is_machine_readable_project_metadata
        and "NHM prosjektdekning" in layers
        and priority_layers_present
    )

    # Even if later documentation defines the priority classes, this classifier
    # deliberately does not grant production seam authority. A separate versioned
    # transform must bind those semantics to the exact DTM1 generation path first.
    evidence = NhmMetadataSurfaceEvidence(
        machine_readable_project_metadata_service=service_is_machine_readable_project_metadata,
        nhm_project_coverage_layer="NHM prosjektdekning" in layers,
        nhm_project_age_layer="NHM prosjektalder" in layers,
        priority_layers_present=priority_layers_present,
        project_type_layer="Prosjekttype" in layers,
        candidate_priority_metadata_present=candidate_priority_metadata_present,
        priority_semantics_documented_for_dtm1_seams=priority_semantics_documented_for_dtm1_seams,
        authorizes_overlap_winner=False,
        production_seam_authority=False,
        authority_status="UNPROVEN",
    )
    return {
        "schema": "nwe.dtm1-nhm-metadata-surface/0.1",
        "evidence": asdict(evidence),
        "required_layers": sorted(_REQUIRED_LAYERS),
        "claim_calibration": {
            "fact": (
                "provider exposes machine-readable NHM project coverage/age and priority-class metadata"
                if candidate_priority_metadata_present
                else "provider metadata surface is present but not proven usable for NHM project priority"
            ),
            "inference": "priority classes may participate in provider project selection or NHM generation",
            "not_proven": (
                "meaning/order of priority classes for national DTM1 generation, map-sheet clipping, "
                "five-pixel border discard, or overlap winner"
            ),
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
