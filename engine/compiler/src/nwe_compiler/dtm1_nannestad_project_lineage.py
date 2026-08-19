from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


class Dtm1NannestadProjectLineageError(RuntimeError):
    pass


_REQUIRED_FIELDS = (
    "NAME",
    "LAS_PROJECT_ID",
    "LAS_PROJECT_NAME",
    "PRIORITET",
    "AARSTALL",
    "SISTEFLYDATO",
    "PROSJEKTNR",
    "HOYDESYSTEM",
    "KOORDINATSYSTEM",
    "OPPLOSNING",
)


@dataclass(frozen=True)
class ProjectRecord:
    catalog_name: str
    las_project_id: int | None
    las_project_name: str | None
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
    """Normalize provider DTM catalog metadata without inventing missing lineage."""
    if not isinstance(payload, dict):
        raise Dtm1NannestadProjectLineageError("project query payload must be an object")
    if payload.get("error") is not None:
        raise Dtm1NannestadProjectLineageError("provider project query returned an error")
    features = payload.get("features")
    if not isinstance(features, list) or not features:
        raise Dtm1NannestadProjectLineageError("provider project query returned no features")

    records: list[ProjectRecord] = []
    seen_catalog_names: set[str] = set()
    for feature in features:
        if not isinstance(feature, dict) or not isinstance(feature.get("attributes"), dict):
            raise Dtm1NannestadProjectLineageError("provider feature lacks attributes")
        attrs = feature["attributes"]
        missing = [field for field in _REQUIRED_FIELDS if field not in attrs]
        if missing:
            raise Dtm1NannestadProjectLineageError(
                "provider project feature missing fields: " + ", ".join(missing)
            )
        catalog_name = attrs["NAME"]
        if not isinstance(catalog_name, str) or not catalog_name.strip():
            raise Dtm1NannestadProjectLineageError("NAME must be non-empty")
        catalog_name = catalog_name.strip()
        if catalog_name in seen_catalog_names:
            raise Dtm1NannestadProjectLineageError("duplicate NAME in provider response")
        seen_catalog_names.add(catalog_name)
        records.append(
            ProjectRecord(
                catalog_name=catalog_name,
                las_project_id=_optional_int(attrs["LAS_PROJECT_ID"]),
                las_project_name=_optional_str(attrs["LAS_PROJECT_NAME"]),
                prioritet=_optional_int(attrs["PRIORITET"]),
                aarstall=_optional_int(attrs["AARSTALL"]),
                sisteflydato=_optional_int(attrs["SISTEFLYDATO"]),
                prosjektnr=_optional_str(attrs["PROSJEKTNR"]),
                hoydesystem=_optional_str(attrs["HOYDESYSTEM"]),
                koordinatsystem=_optional_str(attrs["KOORDINATSYSTEM"]),
                opplosning=_optional_float(attrs["OPPLOSNING"]),
                dtm_interpolationtype=_optional_str(attrs.get("DTM_INTERPOLATIONTYPE")),
                best=_optional_int(attrs.get("BEST")),
                best_open=_optional_int(attrs.get("BEST_OPEN")),
            )
        )
    return tuple(sorted(records, key=lambda record: record.catalog_name))


def assess_overlap_project_lineage(
    *, sample_records: dict[str, tuple[ProjectRecord, ...]]
) -> dict[str, Any]:
    if not sample_records or any(not records for records in sample_records.values()):
        raise Dtm1NannestadProjectLineageError("every overlap sample must resolve catalog metadata")

    sample_catalog_names = {
        sample: [record.catalog_name for record in records]
        for sample, records in sorted(sample_records.items())
    }
    sample_project_ids = {
        sample: sorted({record.las_project_id for record in records if record.las_project_id is not None})
        for sample, records in sorted(sample_records.items())
    }
    unique_project_sets = {tuple(ids) for ids in sample_project_ids.values()}
    all_records = {
        record.catalog_name: record
        for records in sample_records.values()
        for record in records
    }
    records = [asdict(all_records[key]) for key in sorted(all_records)]
    mapped = [record for record in records if record["las_project_id"] is not None]

    return {
        "schema": "nwe.dtm1-nannestad-project-lineage/0.1",
        "sample_catalog_names": sample_catalog_names,
        "sample_project_ids": sample_project_ids,
        "project_set_stable_across_overlap": len(unique_project_sets) == 1,
        "catalog_entry_count": len(records),
        "mapped_project_entry_count": len(mapped),
        "unmapped_project_entry_count": len(records) - len(mapped),
        "records": records,
        "priority_metadata_present": any(record["prioritet"] is not None for record in records),
        "authorizes_overlap_winner": False,
        "production_seam_authority": False,
        "authority_status": "UNPROVEN",
        "claim_calibration": {
            "fact": "provider DTM catalog entries are bound to exact points inside the DTM1 overlap",
            "inference": "non-null project metadata may strengthen provenance only where the provider supplies it",
            "not_proven": (
                "missing project IDs, PRIORITET semantics for national DTM1 generation, source-sample winner, "
                "or authorization to discard the measured five-pixel border"
            ),
        },
    }
