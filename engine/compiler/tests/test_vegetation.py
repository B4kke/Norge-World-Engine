from __future__ import annotations

import math

from shapely.geometry import Point, box, mapping

from nwe_compiler.canonical import canonical_bytes, canonical_sha256
from nwe_compiler.vegetation import (
    ARTIFACT_SCHEMA,
    VegetationCompileError,
    VegetationRepresentativeConfig,
    compile_vegetation_representatives,
)


def feature(source_id: str, geometry, properties: dict[str, str]) -> dict:
    return {
        "source_id": source_id,
        "source_id_kind": "fixture",
        "properties": properties,
        "geometry": mapping(geometry),
        "geometry_sha256": "fixture",
    }


def sample() -> dict:
    return {
        "schema": "nwe.vegetation-source-normalized-sample/0.1-candidate",
        "tile_id": "test_100m",
        "horizontal_crs": "EPSG:25832",
        "truth_boundary": "fixture",
        "source_raw_bindings": {
            "sr16v": {"format": "SOSI", "sha256": "a" * 64, "byte_size": 10},
            "ar50": {"format": "GML", "sha256": "b" * 64, "byte_size": 20},
        },
        "layers": [
            {
                "role": "forest_structure",
                "source_key": "sr16v",
                "features": [
                    feature(
                        "forest-a",
                        box(0, 0, 100, 100),
                        {
                            "srtreslagsam": "1",
                            "srhoydem": "120",
                            "srhoydem_l": "100",
                            "srhoydem_u": "140",
                            "srhoydem_s": "5",
                            "srtrean_ge16": "1000",
                            "srtrean_ge16_l": "800",
                            "srtrean_ge16_u": "1200",
                            "srtrean_ge16_s": "10",
                            "srkronedek": "70",
                            "sr3dfaar": "2024",
                            "oppdateringsdato": "20260101",
                        },
                    ),
                    feature(
                        "unstocked",
                        box(200, 0, 220, 20),
                        {"srtreslagsam": "6", "srhoydem": "100", "srtrean_ge16": "500"},
                    ),
                ],
            },
            {
                "role": "coarse_area_classification",
                "source_key": "ar50",
                "features": [
                    feature("built-half", box(0, 0, 50, 100), {"arealtype": "10"}),
                    feature("forest-half", box(50, 0, 100, 100), {"arealtype": "30"}),
                ],
            },
        ],
    }


def test_source_backed_representatives_are_deterministic_and_renderer_neutral() -> None:
    source = sample()
    first = compile_vegetation_representatives(source)
    second = compile_vegetation_representatives(source)

    assert first == second
    assert canonical_bytes(first) == canonical_bytes(second)
    assert canonical_sha256(first) == canonical_sha256(second)
    assert first["schema"] == ARTIFACT_SCHEMA
    assert first["horizontal_crs"] == "EPSG:25832"
    assert first["authority"]["representative_positions"] == "deterministic-procedural-not-observed-individual-trees"
    assert first["authority"]["terrain_height"] == "not-contained-ground-against-accepted-terrain-downstream"
    assert first["authority"]["renderer_assets"] == "not-contained"

    serialized = canonical_bytes(first).decode("utf-8").lower()
    assert "three" not in serialized
    assert "polyhaven" not in serialized
    assert "render_origin" not in serialized
    assert "object3d" not in serialized


def test_ar50_nonforest_mask_and_sr16_units_are_preserved() -> None:
    artifact = compile_vegetation_representatives(sample())
    assert len(artifact["segments"]) == 1
    segment = artifact["segments"][0]

    assert segment["source_id"] == "forest-a"
    assert segment["tree_class"] == 1
    assert segment["tree_class_label"] == "spruce-dominated"
    assert segment["mean_height_m"] == 12.0
    assert segment["mean_height_uncertainty"] == {
        "lower_95": 10.0,
        "upper_95": 14.0,
        "standard_error_percent": 5.0,
    }
    assert segment["tree_density_ge16_per_ha"] == 1000.0
    assert segment["tree_density_ge16_uncertainty"] == {
        "lower_95": 800.0,
        "upper_95": 1200.0,
        "standard_error_percent": 10.0,
    }
    assert segment["eligible_area_m2"] == 5000.0
    assert segment["modeled_tree_count_ge16"] == 500.0
    assert segment["representative_count"] == 8

    eligible = box(50, 0, 100, 100)
    for instance in artifact["instances"]:
        assert eligible.covers(Point(instance["easting_m"], instance["northing_m"]))
        assert 0.0 <= instance["yaw_rad"] <= math.tau
        assert instance["segment_index"] == 0

    assert artifact["stats"]["ar50_suppressed_area_m2"] == 5000.0
    assert artifact["stats"]["skipped_segments"]["tree_class_not_usable"] == 1
    assert math.isclose(artifact["stats"]["represented_tree_weight_sum"], 500.0)


def test_compiler_config_changes_artifact_identity() -> None:
    source = sample()
    dense = compile_vegetation_representatives(
        source,
        config=VegetationRepresentativeConfig(representative_target_per_hectare=16.0),
    )
    sparse = compile_vegetation_representatives(
        source,
        config=VegetationRepresentativeConfig(representative_target_per_hectare=8.0),
    )
    assert dense["compiler_config_id"] != sparse["compiler_config_id"]
    assert canonical_sha256(dense) != canonical_sha256(sparse)
    assert len(dense["instances"]) == 8
    assert len(sparse["instances"]) == 4
    assert math.isclose(dense["stats"]["represented_tree_weight_sum"], 500.0)
    assert math.isclose(sparse["stats"]["represented_tree_weight_sum"], 500.0)


def test_fail_closed_on_wrong_crs_or_missing_ar50_class() -> None:
    wrong_crs = sample()
    wrong_crs["horizontal_crs"] = "EPSG:4326"
    try:
        compile_vegetation_representatives(wrong_crs)
        raise AssertionError("expected wrong CRS to fail")
    except VegetationCompileError as error:
        assert "EPSG:25832" in str(error)

    missing_class = sample()
    missing_class["layers"][1]["features"][0]["properties"].pop("arealtype")
    try:
        compile_vegetation_representatives(missing_class)
        raise AssertionError("expected missing AR50 class to fail")
    except VegetationCompileError as error:
        assert "arealtype" in str(error)
