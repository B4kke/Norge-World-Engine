from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

from nwe_compiler.canonical import canonical_sha256


MODULE_PATH = Path(__file__).parents[3] / "tools" / "geo" / "compile_nhm_dom_building_surface.py"
SPEC = importlib.util.spec_from_file_location("compile_nhm_dom_building_surface", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
compiler = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = compiler
SPEC.loader.exec_module(compiler)


def _candidate(source_id: str, base: float) -> dict:
    return {
        "source_id": source_id,
        "building": "house",
        "sample_count": 20,
        "footprint_area_m2": 100.0,
        "sampling_area_m2": 80.0,
        "edge_erosion_m": 0.75,
        "p10": base,
        "p25": base + 0.5,
        "p50": base + 1.0,
        "p75": base + 1.5,
        "p90": base + 2.0,
        "p95": base + 2.2,
        "p99": base + 2.5,
        "min": base - 0.2,
        "max": base + 2.8,
        "roof_relief_p95_p25": 1.7,
    }


def _proof() -> dict:
    return {
        "schema": compiler.PROOF_SCHEMA,
        "status": "EXPERIMENT_PASS",
        "tile_id": "epsg25832_611000_6677000_1000m",
        "horizontal_crs": "EPSG:25832",
        "source": {
            "grid_alignment": "EXACT_1M_MATCH",
            "building_artifact_sha256": "a" * 64,
            "dtm": {"raw_sha256": "b" * 64, "grid_sha256": "c" * 64},
            "dom": {"raw_sha256": "d" * 64, "grid_sha256": "e" * 64},
        },
        "building_sampling": {
            "compiled_buildings": 3,
            "unresolved_height_candidates": 2,
            "source_height_calibration_count": 1,
            "edge_erosion_policy": "0.75m-when-result-area-at-least-4m2",
            "credible_delta_range_m": [0.5, 80.0],
        },
        "calibration": {
            key: {
                "count": 1,
                "mae_m": 1.0,
                "median_ae_m": 1.0,
                "p90_ae_m": 1.0,
                "bias_m": 0.0,
                "within_1m_fraction": 1.0,
                "within_2m_fraction": 1.0,
                "within_3m_fraction": 1.0,
            }
            for key in compiler.QUANTILES
            if key in {"p50", "p75", "p90", "p95"}
        },
        "candidates": [_candidate("osm:way:2", 3.0), _candidate("osm:way:1", 4.0)],
    }


def test_building_surface_candidate_is_deterministic_and_source_bound() -> None:
    artifact, verification, first = compiler.compile_artifact(_proof())
    _, second_verification, second = compiler.compile_artifact(_proof())
    assert first == second
    assert verification == second_verification
    assert artifact["schema"] == compiler.ARTIFACT_SCHEMA
    assert [feature["source_id"] for feature in artifact["features"]] == [
        "osm:way:1",
        "osm:way:2",
    ]
    assert artifact["authority"]["roof_shape"] == "not-contained"
    assert artifact["source"]["building_artifact_sha256"] == "a" * 64
    assert verification["status"] == "PASS"
    assert verification["feature_count"] == 2
    assert verification["building_artifact_sha256"] == "a" * 64
    assert verification["compiler_config_id"] == canonical_sha256(artifact["compiler_config"])


def test_building_surface_candidate_rejects_non_monotonic_quantiles() -> None:
    proof = _proof()
    proof["candidates"][0]["p90"] = 2.0
    try:
        compiler.compile_artifact(proof)
    except compiler.BuildingSurfaceCompileError as exc:
        assert "quantiles are not monotonic" in str(exc)
    else:
        raise AssertionError("non-monotonic building surface quantiles were accepted")
