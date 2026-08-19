from __future__ import annotations

from dataclasses import dataclass, asdict


class Dtm1ExportContractError(RuntimeError):
    pass


@dataclass(frozen=True)
class ExportContractObservation:
    nhm_mode: int
    non_overlapping_projects_scope: str
    national_grid_seam_authority: bool
    authority_status: str


def classify_export_contract(*, nhm_mode: int, non_overlapping_projects_documented_for_nhm: int) -> dict:
    """Classify whether Høydedata export overlap controls authorize NHM DTM1 seams.

    Høydedata's published Webtjenester contract documents NonOverlappingProjects
    as a ProjectProduct option that is mandatory/applicable when NHM=0
    (project export). It must not be promoted to national-height-model (NHM=1)
    source authority without an explicit provider contract.
    """
    if nhm_mode not in (0, 1):
        raise Dtm1ExportContractError("NHM mode must be explicit 0 or 1")
    if non_overlapping_projects_documented_for_nhm != 0:
        raise Dtm1ExportContractError(
            "unexpected provider contract: re-review source before changing authority"
        )

    applies = nhm_mode == non_overlapping_projects_documented_for_nhm
    observation = ExportContractObservation(
        nhm_mode=nhm_mode,
        non_overlapping_projects_scope="PROJECT_EXPORT_ONLY" if applies else "OUT_OF_SCOPE_FOR_NHM",
        national_grid_seam_authority=False,
        authority_status="UNPROVEN",
    )
    return {
        "schema": "nwe.dtm1-export-contract/0.1",
        "observation": asdict(observation),
        "claim_calibration": {
            "production_seam_authority": False,
            "authorizes_core_clipping": False,
            "authorizes_source_priority": False,
        },
    }
