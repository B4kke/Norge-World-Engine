from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


class Dtm1NannestadProjectLineageError(RuntimeError):
    pass


_REQUIRED_FIELDS = (
    "LAS_PROJECT_ID",
    "LAS_PROJECT_NAME",
    "PRIORITET",
    "AARSTALL",
    "SISTEFLYDATO",
    "PROSJEKTNR",
    "HOYDESYSTEM",
    "KOORDINATSYSTEM",
    "OPPLOSNING",
    "DTM_INTERPOLATIONTYPE",
    "BEST",
    "BEST_OPEN",
)


@dataclass(frozen=True)
class ProjectRecord:
    las_project_id: int
    las_project_name: str
    prioritet: int | None
    aarstall: int | None
    sisteflydato: int | None
    prosjektnr: str | None
    hoydesystem: str | None
    koordinatsystem: str | None
    opplosning: float | None
    dtm_interpolationtype: str | None
    best: int | None
    best_open: int | None


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise Dtm1NannestadProjectLineageError("expected string or null metadata value")
    value = value.strip()
    return value or None


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise Dtm1NannestadProjectLineageError("expected integer or null metadata value")
    return value


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Dtm1NannestadProjectLineageError("expected numeric or null metadata value")
    return float(value)


def normalize_project_query(payload: dict[str, Any]) -> tuple[ProjectRecord, ...]:
    """Normalize one provider ArcGIS project-coverage query deterministically.

    This validates only provider-returned project metadata. It intentionally does
    not interpret PRIORITET/BEST/BEST_OPEN as DTM1 source-winner semantics.
    """
    if not isinstance(payload, dict):
        raise Dtm1NannestadProjectLineageError("project query payload must be an object")
    if payload.get("error") is not None:
        raise Dtm1NannestadProjectLineageError("provider project query returned an error")
    features = payload.get("features")
    if not isinstance(features, list) or not features:
        raise Dtm1NannestadProjectLineageError("provider project query returned no features")

    records: list[ProjectRecord] = []
    seen: set[int] = set()
    for feature in features:
        if not isinstance(feature, dict) or not isinstance(feature.get("attributes"), dict):
            raise Dtm1NannestadProjectLineageError("provider feature lacks attributes")
        attrs = feature["attributes"]
        missing = [field for field in _REQUIRED_FIELDS if field not in attrs]
        if missing:
            raise Dtm1NannestadProjectLineageError(
                "provider project feature missing fields: " + ", ".join(missing)
            )
        project_id = attrs["LAS_PROJECT_ID"]
        if isinstance(project_id, bool) or not isinstance(project_id, int):
            raise Dtm1NannestadProjectLineageError("LAS_PROJECT_ID must be an integer")
        name = attrs["LAS_PROJECT_NAME"]
        if not isinstance(name, str) or not name.strip():
            raise Dtm1NannestadProjectLineageError("LAS_PROJECT_NAME must be non-empty")
        if project_id in seen:
            raise Dtm1NannestadProjectLineageError("duplicate LAS_PROJECT_ID in provider response")
        seen.add(project_id)
        records.append(
            ProjectRecord(
                las_project_id=project_id,
                las_project_name=name.strip(),
                prioritet=_optional_int(attrs["PRIORITET"]),
                aarstall=_optional_int(attrs["AARSTALL"]),
                sisteflydato=_optional_int(attrs["SISTEFLYDATO"]),
                prosjektnr=_optional_str(attrs["PROSJEKTNR"]),
                hoydesystem=_optional_str(attrs["HOYDESYSTEM"]),
                koordinatsystem=_optional_str(attrs["KOORDINATSYSTEM"]),
                opplosning=_optional_float(attrs["OPPLOSNING"]),
                dtm_interpolationtype=_optional_str(attrs["DTM_INTERPOLATIONTYPE"]),
                best=_optional_int(attrs["BEST"]),
                best_open=_optional_int(attrs["BEST_OPEN"]),
            )
        )
    return tuple(sorted(records, key=lambda record: (record.las_project_id, record.las_project_name)))


def assess_overlap_project_lineage(
    *,
    sample_records: dict[str, tuple[ProjectRecord, ...]],
) -> dict[str, Any]:
    if not sample_records:
        raise Dtm1NannestadProjectLineageError("at least one overlap sample is required")
    if any(not isinstance(name, str) or not name for name in sample_records):
        raise Dtm1NannestadProjectLineageError("sample names must be non-empty strings")
    if any(not records for records in sample_records.values()):
        raise Dtm1NannestadProjectLineageError("every overlap sample must resolve project metadata")

    normalized_sets = {
        sample: tuple(record.las_project_id for record in records)
        for sample, records in sorted(sample_records.items())
    }
    unique_sets = {project_ids for project_ids in normalized_sets.values()}
    stable = len(unique_sets) == 1
    all_records = {
        record.las_project_id: record
        for records in sample_records.values()
        for record in records
    }
    projects = [asdict(all_records[key]) for key in sorted(all_records)]

    return {
        "schema": "nwe.dtm1-nannestad-project-lineage/0.1",
        "sample_project_ids": {key: list(value) for key, value in normalized_sets.items()},
        "project_set_stable_across_overlap": stable,
        "projects": projects,
        "priority_metadata_present": any(project["prioritet"] is not None for project in projects),
        "best_metadata_present": any(
            project["best"] is not None or project["best_open"] is not None for project in projects
        ),
        "authorizes_overlap_winner": False,
        "production_seam_authority": False,
        "authority_status": "UNPROVEN",
        "claim_calibration": {
            "fact": "provider project coverage metadata is bound to exact points inside the DTM1 overlap",
            "inference": "stable project membership can strengthen provenance for the overlap area",
            "not_proven": (
                "PRIORITET/BEST/BEST_OPEN meaning for national DTM1 generation, source-sample winner, "
                "or authorization to discard the measured five-pixel border"
            ),
        },
    }
