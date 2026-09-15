#!/usr/bin/env python3
"""Compile real NHM DOM-DTM building measurements into a deterministic candidate artifact."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from nwe_compiler.canonical import canonical_bytes, canonical_sha256


PROOF_SCHEMA = "nwe.nhm-dom-building-height-proof/0.1"
ARTIFACT_SCHEMA = "nwe.building-surface-artifact/0.1-candidate"
VERIFICATION_SCHEMA = "nwe.building-surface-artifact-verification/0.1"
QUANTILES = ("p10", "p25", "p50", "p75", "p90", "p95", "p99")


class BuildingSurfaceCompileError(RuntimeError):
    pass


def compiler_config(proof: dict) -> dict:
    sampling = proof["building_sampling"]
    return {
        "schema": "nwe.building-surface-compiler-config/0.1",
        "operation": "nhm-dom-minus-dtm-inside-osm-footprint-quantiles",
        "edge_erosion_policy": sampling["edge_erosion_policy"],
        "credible_delta_range_m": sampling["credible_delta_range_m"],
        "quantiles": list(QUANTILES),
        "source_grid_requirement": "exact-aligned-epsg25832-1m-dtm-dom",
        "roof_shape_inference": "none",
        "runtime_geometry_selection": "not-contained-in-artifact",
    }


def compile_artifact(proof: dict) -> tuple[dict, dict, bytes]:
    if proof.get("schema") != PROOF_SCHEMA or proof.get("status") != "EXPERIMENT_PASS":
        raise BuildingSurfaceCompileError("input proof schema/status is not accepted")
    if proof.get("horizontal_crs") != "EPSG:25832":
        raise BuildingSurfaceCompileError("building surface proof must be EPSG:25832")
    source = proof.get("source")
    if not isinstance(source, dict) or source.get("grid_alignment") != "EXACT_1M_MATCH":
        raise BuildingSurfaceCompileError("building surface proof lacks exact DTM/DOM alignment")
    building_sha = source.get("building_artifact_sha256")
    if not isinstance(building_sha, str) or len(building_sha) != 64:
        raise BuildingSurfaceCompileError("building artifact SHA-256 is missing")

    config = compiler_config(proof)
    config_id = canonical_sha256(config)
    features = []
    seen: set[str] = set()
    for candidate in proof.get("candidates", []):
        if not isinstance(candidate, dict):
            raise BuildingSurfaceCompileError("candidate must be an object")
        source_id = candidate.get("source_id")
        if not isinstance(source_id, str) or not source_id or source_id in seen:
            raise BuildingSurfaceCompileError("candidate source_id must be unique/non-empty")
        seen.add(source_id)
        measurements = {}
        for key in (*QUANTILES, "min", "max"):
            value = candidate.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise BuildingSurfaceCompileError(f"{source_id}: invalid {key}")
            measurements[key] = float(value)
        if any(measurements[a] > measurements[b] for a, b in zip(QUANTILES, QUANTILES[1:])):
            raise BuildingSurfaceCompileError(f"{source_id}: quantiles are not monotonic")
        sample_count = candidate.get("sample_count")
        if isinstance(sample_count, bool) or not isinstance(sample_count, int) or sample_count < 4:
            raise BuildingSurfaceCompileError(f"{source_id}: sample_count is invalid")
        features.append(
            {
                "source_id": source_id,
                "building": str(candidate.get("building") or "yes"),
                "sample_count": sample_count,
                "footprint_area_m2": float(candidate["footprint_area_m2"]),
                "sampling_area_m2": float(candidate["sampling_area_m2"]),
                "edge_erosion_m": float(candidate["edge_erosion_m"]),
                "height_delta_m": measurements,
                "roof_relief_p95_p25_m": float(candidate["roof_relief_p95_p25"]),
            }
        )
    features.sort(key=lambda item: item["source_id"])
    if not features:
        raise BuildingSurfaceCompileError("proof has no usable building surface candidates")

    artifact = {
        "schema": ARTIFACT_SCHEMA,
        "tile_id": proof["tile_id"],
        "horizontal_crs": proof["horizontal_crs"],
        "authority": {
            "footprints": "source-backed-osm-building-artifact",
            "surface": "source-backed-kartverket-nhm-dom-1m",
            "terrain": "source-backed-kartverket-nhm-dtm-1m",
            "measurements": "derived-dom-minus-dtm-quantiles-inside-footprint",
            "individual_roof_planes": "not-observed-or-contained",
            "roof_shape": "not-contained",
            "presentation_geometry": "not-contained",
        },
        "source": {
            "building_artifact_sha256": building_sha,
            "dtm_raw_sha256": source["dtm"]["raw_sha256"],
            "dtm_grid_sha256": source["dtm"]["grid_sha256"],
            "dom_raw_sha256": source["dom"]["raw_sha256"],
            "dom_grid_sha256": source["dom"]["grid_sha256"],
        },
        "compiler_config": config,
        "compiler_config_id": config_id,
        "features": features,
        "stats": {
            "feature_count": len(features),
            "source_building_count": proof["building_sampling"]["compiled_buildings"],
            "unresolved_height_candidate_count": proof["building_sampling"]["unresolved_height_candidates"],
            "source_height_calibration_count": proof["building_sampling"]["source_height_calibration_count"],
        },
        "calibration": proof["calibration"],
        "truth_boundary": (
            "Per-footprint DOM-DTM distributions are source-derived measurements. "
            "Any selection of p50/p90/p95 as wall/eave/ridge geometry is a downstream "
            "presentation policy, not surveyed roof geometry."
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
        "building_artifact_sha256": building_sha,
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
    artifact, verification, artifact_bytes = compile_artifact(proof)
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
    except BuildingSurfaceCompileError as exc:
        print(f"NWE_BUILDING_SURFACE_COMPILE_REJECTED: {exc}", file=__import__("sys").stderr)
        raise SystemExit(1)
