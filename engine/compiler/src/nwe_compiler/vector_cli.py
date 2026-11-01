from __future__ import annotations

import argparse
import json
from pathlib import Path
from time import perf_counter

from nwe_compiler.acquisition import acquire_source, nvdb_contract, osm_contract
from nwe_compiler.vector_artifacts import compile_building_artifact, compile_road_artifact, persist_compiled_artifact


BUILDING_SEMANTIC_FIELDS = (
    "roof_shape",
    "roof_height",
    "roof_levels",
    "roof_direction",
    "roof_orientation",
    "roof_material",
    "roof_colour",
    "building_material",
    "building_colour",
)


def building_semantic_stats(artifact_payload: dict) -> dict:
    features = artifact_payload.get("features")
    if not isinstance(features, list):
        raise ValueError("building artifact lacks features for semantic stats")
    field_counts = {
        field: sum(
            1
            for feature in features
            if isinstance(feature, dict) and feature.get(field) not in (None, "")
        )
        for field in BUILDING_SEMANTIC_FIELDS
    }
    building_types: dict[str, int] = {}
    source_height_count = 0
    for feature in features:
        if not isinstance(feature, dict):
            continue
        building_type = str(feature.get("building") or "yes")
        building_types[building_type] = building_types.get(building_type, 0) + 1
        if feature.get("height_m") is not None and feature.get("height_source") != "unresolved":
            source_height_count += 1
    roof_fields = ("roof_shape", "roof_height", "roof_levels", "roof_direction", "roof_orientation", "roof_material", "roof_colour")
    surface_fields = ("roof_material", "roof_colour", "building_material", "building_colour")
    return {
        "feature_count": len(features),
        "source_height_count": source_height_count,
        "unresolved_height_count": len(features) - source_height_count,
        "features_with_any_roof_semantics": sum(
            1 for feature in features
            if isinstance(feature, dict) and any(feature.get(field) not in (None, "") for field in roof_fields)
        ),
        "features_with_any_surface_semantics": sum(
            1 for feature in features
            if isinstance(feature, dict) and any(feature.get(field) not in (None, "") for field in surface_fields)
        ),
        "field_counts": field_counts,
        "building_type_counts": {key: building_types[key] for key in sorted(building_types)},
    }


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="Acquire/cache and compile deterministic Nannestad vector artifacts")
    command.add_argument("--cache-root", type=Path, default=Path("data"))
    command.add_argument("--source", choices=("all", "roads", "buildings"), default="all")
    command.add_argument("--refresh", action="store_true", help="fetch a new raw source snapshot")
    command.add_argument("--offline", action="store_true", help="forbid source network access; require raw cache")
    command.add_argument("--road-snap-m", type=float, default=0.25)
    return command


def _one(source: str, args) -> dict:
    contract = nvdb_contract() if source == "roads" else osm_contract()
    t0 = perf_counter()
    acquired = acquire_source(contract, args.cache_root, refresh=args.refresh, offline=args.offline)
    t1 = perf_counter()
    compiled = compile_road_artifact(acquired, snap_m=args.road_snap_m) if source == "roads" else compile_building_artifact(acquired)
    t2 = perf_counter()
    persisted = persist_compiled_artifact(compiled, args.cache_root)
    t3 = perf_counter()
    result = {
        "source": source,
        "request_url": contract.request_url,
        "raw_cache_hit": acquired.cache_hit,
        "raw_sha256": acquired.raw_sha256,
        "raw_bytes": acquired.byte_size,
        "raw_object_count": acquired.raw_object_count,
        "source_selected_count": acquired.selected_feature_count,
        "normalized_count": persisted.normalized_count,
        "compiled_count": persisted.compiled_count,
        "artifact_sha256": persisted.artifact_sha256,
        "artifact_bytes": len(persisted.artifact_bytes),
        "artifact_path": persisted.artifact_path,
        "bundle_path": persisted.bundle_path,
        "timing_ms": {
            "acquire": round((t1 - t0) * 1000, 3),
            "normalize_compile": round((t2 - t1) * 1000, 3),
            "persist": round((t3 - t2) * 1000, 3),
            "total": round((t3 - t0) * 1000, 3),
        },
    }
    if source == "buildings":
        result["semantic_stats"] = building_semantic_stats(persisted.artifact_payload)
    return result


def main() -> int:
    args = parser().parse_args()
    sources = ("roads", "buildings") if args.source == "all" else (args.source,)
    results = [_one(source, args) for source in sources]
    print(json.dumps({"status": "PASS", "results": results}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
