#!/usr/bin/env python3
"""Compile strong NHM DOM roof-direction fits into a deterministic candidate artifact."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from nwe_compiler.canonical import canonical_bytes, canonical_sha256


PROOF_SCHEMA = "nwe.nhm-dom-roof-orientation-proof/0.1"
ARTIFACT_SCHEMA = "nwe.building-roof-orientation-artifact/0.1-candidate"
VERIFICATION_SCHEMA = "nwe.building-roof-orientation-verification/0.1"

MIN_TENT_R2 = 0.85
MAX_TENT_RMSE_M = 0.5
MIN_R2_IMPROVEMENT = 0.30
MIN_ORTHOGONAL_GAP = 0.30
MIN_RELIEF_M = 1.0
MAX_RELIEF_M = 5.0
MIN_SLOPE = 0.12
MAX_SLOPE = 1.2
METRIC_DECIMALS = 9


class RoofOrientationCompileError(RuntimeError):
    pass


def _stable_metric(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RoofOrientationCompileError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise RoofOrientationCompileError(f"{label} must be finite")
    return round(result, METRIC_DECIMALS)


def compiler_config() -> dict:
    return {
        "schema": "nwe.building-roof-orientation-compiler-config/0.1",
        "operation": "admit-strong-nhm-dom-centered-tent-direction-fit",
        "input_status": "ACCEPTED_GABLE_LIKE_DIRECTION",
        "min_tent_r2": MIN_TENT_R2,
        "max_tent_rmse_m": MAX_TENT_RMSE_M,
        "min_r2_improvement_over_plane": MIN_R2_IMPROVEMENT,
        "min_orthogonal_r2_gap": MIN_ORTHOGONAL_GAP,
        "relief_range_m": [MIN_RELIEF_M, MAX_RELIEF_M],
        "roof_slope_range_m_per_m": [MIN_SLOPE, MAX_SLOPE],
        "fit_metric_quantization_decimals": METRIC_DECIMALS,
        "roof_shape_claim": "none",
        "surveyed_ridge_claim": False,
        "runtime_geometry": "not-contained",
    }


def _admitted(candidate: dict) -> bool:
    if candidate.get("status") != "ACCEPTED_GABLE_LIKE_DIRECTION":
        return False
    tent_r2 = _stable_metric(candidate.get("tent_r2"), "tent_r2")
    tent_rmse = _stable_metric(candidate.get("tent_rmse_m"), "tent_rmse_m")
    improvement = _stable_metric(
        candidate.get("r2_improvement_over_plane"),
        "r2_improvement_over_plane",
    )
    orthogonal_gap = _stable_metric(candidate.get("orthogonal_gap"), "orthogonal_gap")
    relief = _stable_metric(
        candidate.get("winsorized_p10_p95_relief_m"),
        "winsorized_p10_p95_relief_m",
    )
    slope = _stable_metric(
        candidate.get("tent_roof_slope_m_per_m"),
        "tent_roof_slope_m_per_m",
    )
    return (
        tent_r2 >= MIN_TENT_R2
        and tent_rmse <= MAX_TENT_RMSE_M
        and improvement >= MIN_R2_IMPROVEMENT
        and orthogonal_gap >= MIN_ORTHOGONAL_GAP
        and MIN_RELIEF_M <= relief <= MAX_RELIEF_M
        and MIN_SLOPE <= slope <= MAX_SLOPE
    )


def compile_artifact(proof: dict) -> tuple[dict, dict, bytes]:
    if proof.get("schema") != PROOF_SCHEMA or proof.get("status") != "EXPERIMENT_PASS":
        raise RoofOrientationCompileError("roof-orientation proof schema/status is not accepted")
    if proof.get("horizontal_crs") != "EPSG:25832":
        raise RoofOrientationCompileError("roof-orientation proof must be EPSG:25832")
    source = proof.get("source")
    required_source = (
        "building_artifact_sha256",
        "dtm_raw_sha256",
        "dtm_grid_sha256",
        "dom_raw_sha256",
        "dom_grid_sha256",
    )
    if not isinstance(source, dict) or any(
        not isinstance(source.get(key), str) or len(source[key]) != 64
        for key in required_source
    ):
        raise RoofOrientationCompileError("roof-orientation proof source hashes are incomplete")
    if source.get("runtime_source_calls") != 0:
        raise RoofOrientationCompileError("roof-orientation proof was not source-offline at fit time")

    config = compiler_config()
    config_id = canonical_sha256(config)
    features = []
    seen: set[str] = set()
    for candidate in proof.get("candidates", []):
        if not isinstance(candidate, dict) or not _admitted(candidate):
            continue
        source_id = candidate.get("source_id")
        if not isinstance(source_id, str) or not source_id or source_id in seen:
            raise RoofOrientationCompileError("admitted roof candidate source_id is invalid")
        seen.add(source_id)
        angle = _stable_metric(
            candidate["ridge_orientation_deg_from_east_ccw"],
            f"{source_id}.ridge_orientation_deg_from_east_ccw",
        ) % 180.0
        if not 0.0 <= angle < 180.0:
            raise RoofOrientationCompileError(f"{source_id}: invalid ridge angle")
        features.append(
            {
                "source_id": source_id,
                "building": str(candidate.get("building") or "yes"),
                "ridge_orientation_deg_from_east_ccw": angle,
                "sample_count": int(candidate["sample_count"]),
                "fit": {
                    "tent_r2": _stable_metric(candidate["tent_r2"], f"{source_id}.tent_r2"),
                    "tent_rmse_m": _stable_metric(
                        candidate["tent_rmse_m"],
                        f"{source_id}.tent_rmse_m",
                    ),
                    "r2_improvement_over_plane": _stable_metric(
                        candidate["r2_improvement_over_plane"],
                        f"{source_id}.r2_improvement_over_plane",
                    ),
                    "orthogonal_gap": _stable_metric(
                        candidate["orthogonal_gap"],
                        f"{source_id}.orthogonal_gap",
                    ),
                    "winsorized_p10_p95_relief_m": _stable_metric(
                        candidate["winsorized_p10_p95_relief_m"],
                        f"{source_id}.winsorized_p10_p95_relief_m",
                    ),
                    "tent_roof_slope_m_per_m": _stable_metric(
                        candidate["tent_roof_slope_m_per_m"],
                        f"{source_id}.tent_roof_slope_m_per_m",
                    ),
                },
                "footprint_context": {
                    "long_axis_deg_from_east_ccw": (
                        _stable_metric(
                            candidate["footprint_long_axis_deg_from_east_ccw"],
                            f"{source_id}.footprint_long_axis_deg_from_east_ccw",
                        )
                        if candidate.get("footprint_long_axis_deg_from_east_ccw") is not None
                        else None
                    ),
                    "ridge_vs_long_axis_deg": (
                        _stable_metric(
                            candidate["ridge_vs_footprint_long_axis_deg"],
                            f"{source_id}.ridge_vs_footprint_long_axis_deg",
                        )
                        if candidate.get("ridge_vs_footprint_long_axis_deg") is not None
                        else None
                    ),
                },
            }
        )
    features.sort(key=lambda item: item["source_id"])
    if not features:
        raise RoofOrientationCompileError("no roof direction fit passed the strong admission gate")

    artifact = {
        "schema": ARTIFACT_SCHEMA,
        "tile_id": proof["tile_id"],
        "horizontal_crs": proof["horizontal_crs"],
        "authority": {
            "footprints": "source-backed-osm-building-artifact",
            "surface": "source-backed-kartverket-nhm-dom-minus-dtm-1m",
            "ridge_direction": "derived-high-confidence-tent-fit-candidate",
            "roof_shape": "not-contained",
            "surveyed_ridge": "not-contained",
            "presentation_geometry": "not-contained",
        },
        "source": {key: source[key] for key in required_source},
        "compiler_config": config,
        "compiler_config_id": config_id,
        "features": features,
        "stats": {
            "source_building_count": int(proof["stats"]["compiled_buildings"]),
            "spatially_analyzed": int(proof["stats"]["spatially_analyzed"]),
            "broad_fit_accepted": int(proof["stats"]["accepted_gable_like_direction"]),
            "strong_direction_count": len(features),
        },
        "truth_boundary": (
            "Ridge direction is a deterministic high-confidence interpretation of "
            "source-backed 1 m DOM-DTM height samples. It is not surveyed FKB ridge "
            "geometry and does not establish roof shape, ridge offset or eave geometry."
        ),
    }
    artifact_bytes = canonical_bytes(artifact)
    semantic_payload = {
        "schema": ARTIFACT_SCHEMA,
        "tile_id": artifact["tile_id"],
        "horizontal_crs": artifact["horizontal_crs"],
        "compiler_config_id": config_id,
        "features": features,
    }
    verification = {
        "schema": VERIFICATION_SCHEMA,
        "status": "PASS",
        "artifact_sha256": hashlib.sha256(artifact_bytes).hexdigest(),
        "artifact_semantic_sha256": canonical_sha256(semantic_payload),
        "artifact_byte_size": len(artifact_bytes),
        "compiler_config_id": config_id,
        "building_artifact_sha256": source["building_artifact_sha256"],
        "feature_count": len(features),
        "source_building_count": artifact["stats"]["source_building_count"],
    }
    return artifact, verification, artifact_bytes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--proof", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verification", type=Path, required=True)
    args = parser.parse_args()
    proof = json.loads(args.proof.read_text(encoding="utf-8"))
    _, verification, artifact_bytes = compile_artifact(proof)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(artifact_bytes)
    args.verification.parent.mkdir(parents=True, exist_ok=True)
    args.verification.write_text(
        json.dumps(verification, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(verification, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RoofOrientationCompileError as exc:
        print(f"NWE_ROOF_ORIENTATION_COMPILE_REJECTED: {exc}", file=__import__("sys").stderr)
        raise SystemExit(1)
