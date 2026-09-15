from __future__ import annotations

from nwe_compiler.vector_cli import building_semantic_stats


def test_building_semantic_stats_make_source_coverage_explicit() -> None:
    payload = {
        "features": [
            {
                "building": "house",
                "height_m": 6.0,
                "height_source": "osm:height",
                "roof_shape": "gabled",
                "roof_material": "tile",
                "building_colour": "white",
            },
            {
                "building": "garage",
                "height_m": None,
                "height_source": "unresolved",
            },
            {
                "building": "barn",
                "height_m": 7.5,
                "height_source": "osm:building:levels*3m",
                "roof_colour": "#7f2f21",
            },
        ]
    }
    stats = building_semantic_stats(payload)
    assert stats["feature_count"] == 3
    assert stats["source_height_count"] == 2
    assert stats["unresolved_height_count"] == 1
    assert stats["features_with_any_roof_semantics"] == 2
    assert stats["features_with_any_surface_semantics"] == 2
    assert stats["field_counts"]["roof_shape"] == 1
    assert stats["field_counts"]["roof_material"] == 1
    assert stats["field_counts"]["roof_colour"] == 1
    assert stats["field_counts"]["building_colour"] == 1
    assert stats["building_type_counts"] == {"barn": 1, "garage": 1, "house": 1}
