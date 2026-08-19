from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable, Mapping


class Dtm1NhmSeamPriorityAuditError(RuntimeError):
    pass


@dataclass(frozen=True)
class PriorityProject:
    priority: int
    project_id: int
    project_name: str
    year: int


@dataclass(frozen=True)
class NhmSeamPriorityEvidence:
    seam_priority_stack_present: bool
    distinct_projects: bool
    priority_is_recency_order: bool
    nhm_project_coverage_binding_present: bool
    authorizes_overlap_winner: bool
    production_seam_authority: bool
    authority_status: str


def _project(record: Mapping[str, object]) -> PriorityProject:
    try:
        priority = int(record["PRIORITET"])
        project_id = int(record["LAS_PROJECT_ID"])
        project_name = str(record["LAS_PROJECT_NAME"]).strip()
        year = int(record["AARSTALL"])
    except (KeyError, TypeError, ValueError) as exc:
        raise Dtm1NhmSeamPriorityAuditError("malformed provider priority record") from exc
    if priority not in {1, 2, 3} or project_id <= 0 or not project_name or year < 1900:
        raise Dtm1NhmSeamPriorityAuditError("invalid provider priority record")
    return PriorityProject(priority, project_id, project_name, year)


def assess_nhm_seam_priority_stack(
    *,
    priority_records: Iterable[Mapping[str, object]],
    nhm_project_coverage_records: Iterable[Mapping[str, object]],
) -> dict:
    """Classify provider project-priority metadata at a DTM1 seam.

    This audit intentionally cannot grant production seam authority. Its purpose is
    to determine whether the provider metadata supplies one unambiguous NHM project
    binding, or instead exposes multiple ranked project-coverages whose semantics
    still require a documented generation rule.
    """
    projects = tuple(_project(record) for record in priority_records)
    if not projects:
        raise Dtm1NhmSeamPriorityAuditError("no provider priority records at seam")

    priorities = {project.priority for project in projects}
    if priorities != {1, 2, 3}:
        raise Dtm1NhmSeamPriorityAuditError(
            f"expected explicit priority stack 1/2/3 at seam, observed {sorted(priorities)}"
        )

    by_priority = {priority: [p for p in projects if p.priority == priority] for priority in (1, 2, 3)}
    if any(len(items) != 1 for items in by_priority.values()):
        raise Dtm1NhmSeamPriorityAuditError("priority layer is ambiguous at sampled seam")

    ordered = [by_priority[p][0] for p in (1, 2, 3)]
    distinct_projects = len({p.project_id for p in ordered}) == 3
    priority_is_recency_order = ordered[0].year >= ordered[1].year >= ordered[2].year

    coverage = tuple(nhm_project_coverage_records)
    nhm_project_coverage_binding_present = len(coverage) == 1

    evidence = NhmSeamPriorityEvidence(
        seam_priority_stack_present=True,
        distinct_projects=distinct_projects,
        priority_is_recency_order=priority_is_recency_order,
        nhm_project_coverage_binding_present=nhm_project_coverage_binding_present,
        authorizes_overlap_winner=False,
        production_seam_authority=False,
        authority_status="UNPROVEN",
    )
    return {
        "schema": "nwe.dtm1-nhm-seam-priority-audit/0.1",
        "projects": [asdict(project) for project in ordered],
        "evidence": asdict(evidence),
        "claim_calibration": {
            "fact": (
                "provider priority layers 1/2/3 each intersect the sampled DTM1 seam"
            ),
            "negative_evidence": (
                "priority numeric order is not a newest-project ordering"
                if not priority_is_recency_order
                else "sample does not disprove recency ordering"
            ),
            "not_proven": (
                "which project contributes national DTM1 samples, whether priority controls NHM generation, "
                "or which packaged GeoTIFF sample wins in overlap"
            ),
            "production_seam_authority": False,
            "authority_status": "UNPROVEN",
        },
    }
