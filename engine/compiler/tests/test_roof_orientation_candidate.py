from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

from nwe_compiler.canonical import canonical_sha256


MODULE_PATH = Path(__file__).parents[3] / "tools" / "geo" / "compile_nhm_dom_roof_orientation.py"
SPEC = importlib.util.spec_from_file_location("compile_nhm_dom_roof_orientation", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
compiler = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = compiler
SPEC.loader.exec_module(compiler)


def _candidate(source_id: str, *, strong: bool = True) -> dict:
    return {
        "source_id": source_id,
        "building": "house",
        "status": "ACCEPTED_GABLE_LIKE_DIRECTION",
        "sample_count": 64,
        "ridge_orientation_deg_from_east_ccw": 32.0,
        "tent_r2": 0.94 if strong else 0.70,
        "tent_rmse_m": 0.22,
        "r2_improvement_over_plane": 0.72,
        "orthogonal_gap": 0.76,
        "winsorized_p10_p95_relief_m": 2.4,
        "tent_roof_slope_m_per_m": 0.48,
        "footprint_long_axis_deg_from_east_ccw": 30.0,
        "ridge_vs_footprint_long_axis_deg": 2.0,
    }


def _proof() -> dict:
    return {
        "schema": compiler.PROOF_SCHEMA,
        "status": "EXPERIMENT_PASS",
        "tile_id": "epsg25832_611000_6677000_1000m",
        "horizontal_crs": "EPSG:25832",
        "source": {
            "building_artifact_sha256": "a" * 64,
            "dtm_raw_sha256": "b" * 64,
            "dtm_grid_sha256": "c" * 64,
            "dom_raw_sha256": "d" * 64,
            "dom_grid_sha256": "e" * 64,
            "runtime_source_calls": 0,
        },
        "stats": {
            "compiled_buildings": 135,
            "spatially_analyzed": 100,
            "accepted_gable_like_direction": 2,
        },
        "candidates": [
            _candidate("osm:way:2", strong=False),
            _candidate("osm:way:1", strong=True),
        ],
    }


def test_strong_roof_direction_artifact_is_deterministic_and_truth_bounded() -> None:
    artifact, verification, first = compiler.compile_artifact(_proof())
    second_artifact, second_verification, second = compiler.compile_artifact(_proof())
    assert first == second
    assert artifact == second_artifact
    assert verification == second_verification
    assert artifact["schema"] == compiler.ARTIFACT_SCHEMA
    assert artifact["stats"]["strong_direction_count"] == 1
    assert [item["source_id"] for item in artifact["features"]] == ["osm:way:1"]
    assert artifact["features"][0]["ridge_orientation_deg_from_east_ccw"] == 32.0
    assert artifact["authority"]["roof_shape"] == "not-contained"
    assert artifact["authority"]["surveyed_ridge"] == "not-contained"
    assert artifact["source"]["building_artifact_sha256"] == "a" * 64
    assert verification["feature_count"] == 1
    assert verification["status"] == "PASS"
    assert verification["compiler_config_id"] == canonical_sha256(
        artifact["compiler_config"]
    )


def test_machine_epsilon_fit_drift_keeps_candidate_bytes_identical() -> None:
    first_proof = _proof()
    second_proof = _proof()
    second = second_proof["candidates"][1]
    second["tent_r2"] += 2e-13
    second["tent_rmse_m"] -= 3e-14
    second["r2_improvement_over_plane"] += 4e-13
    second["orthogonal_gap"] -= 2e-13
    second["tent_roof_slope_m_per_m"] += 1e-13
    second["footprint_long_axis_deg_from_east_ccw"] += 3e-13
    second["ridge_vs_footprint_long_axis_deg"] -= 2e-13

    first_artifact, first_verification, first_bytes = compiler.compile_artifact(
        first_proof
    )
    second_artifact, second_verification, second_bytes = compiler.compile_artifact(
        second_proof
    )
    assert first_bytes == second_bytes
    assert first_artifact == second_artifact
    assert first_verification == second_verification
    assert (
        first_artifact["compiler_config"]["fit_metric_quantization_decimals"]
        == compiler.METRIC_DECIMALS
    )


def test_strong_roof_direction_compiler_rejects_source_online_proof() -> None:
    proof = _proof()
    proof["source"]["runtime_source_calls"] = 1
    try:
        compiler.compile_artifact(proof)
    except compiler.RoofOrientationCompileError as exc:
        assert "source-offline" in str(exc)
    else:
        raise AssertionError("source-online roof direction proof was accepted")


def test_strong_roof_direction_compiler_rejects_when_no_fit_passes() -> None:
    proof = _proof()
    proof["candidates"] = [_candidate("osm:way:1", strong=False)]
    try:
        compiler.compile_artifact(proof)
    except compiler.RoofOrientationCompileError as exc:
        assert "no roof direction fit passed" in str(exc)
    else:
        raise AssertionError("weak roof direction candidate was accepted")
