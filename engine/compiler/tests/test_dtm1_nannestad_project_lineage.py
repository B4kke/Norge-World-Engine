import pytest

from nwe_compiler.dtm1_nannestad_project_lineage import (
    Dtm1NannestadProjectLineageError,
    assess_overlap_project_lineage,
    normalize_project_query,
)


def _payload(project_id=101, name="Nannestad 2020", prioritet=1, catalog_name="dtm-a"):
    return {
        "features": [
            {
                "attributes": {
                    "NAME": catalog_name,
                    "LAS_PROJECT_ID": project_id,
                    "LAS_PROJECT_NAME": name if project_id is not None else None,
                    "PRIORITET": prioritet,
                    "AARSTALL": 2020,
                    "SISTEFLYDATO": 1596240000000,
                    "PROSJEKTNR": "P-101",
                    "HOYDESYSTEM": "NN2000",
                    "KOORDINATSYSTEM": "EUREF89 UTM33",
                    "OPPLOSNING": 1.0,
                    "DTM_INTERPOLATIONTYPE": "Natural Neighbor",
                }
            }
        ]
    }


def test_normalizes_provider_project_metadata_deterministically():
    records = normalize_project_query(_payload())
    assert len(records) == 1
    assert records[0].catalog_name == "dtm-a"
    assert records[0].las_project_id == 101
    assert records[0].prioritet == 1


def test_rejects_missing_required_provider_field():
    payload = _payload()
    del payload["features"][0]["attributes"]["PRIORITET"]
    with pytest.raises(Dtm1NannestadProjectLineageError, match="missing fields"):
        normalize_project_query(payload)


def test_rejects_empty_spatial_query_result():
    with pytest.raises(Dtm1NannestadProjectLineageError, match="no features"):
        normalize_project_query({"features": []})


def test_stable_priority_metadata_never_becomes_seam_authority():
    records = normalize_project_query(_payload())
    result = assess_overlap_project_lineage(
        sample_records={"south": records, "center": records, "north": records}
    )
    assert result["project_set_stable_across_overlap"] is True
    assert result["mapped_project_entry_count"] == 1
    assert result["priority_metadata_present"] is True
    assert result["authorizes_overlap_winner"] is False
    assert result["production_seam_authority"] is False


def test_unmapped_catalog_entry_is_preserved_not_invented():
    records = normalize_project_query(_payload(project_id=None, name="", prioritet=None))
    result = assess_overlap_project_lineage(sample_records={"center": records})
    assert result["mapped_project_entry_count"] == 0
    assert result["unmapped_project_entry_count"] == 1
    assert result["sample_project_ids"] == {"center": []}
    assert result["production_seam_authority"] is False


def test_different_project_sets_are_recorded_not_resolved():
    south = normalize_project_query(_payload(project_id=101, name="South", catalog_name="south"))
    north = normalize_project_query(
        _payload(project_id=202, name="North", prioritet=2, catalog_name="north")
    )
    result = assess_overlap_project_lineage(sample_records={"south": south, "north": north})
    assert result["project_set_stable_across_overlap"] is False
    assert result["sample_project_ids"] == {"north": [202], "south": [101]}
    assert result["production_seam_authority"] is False
