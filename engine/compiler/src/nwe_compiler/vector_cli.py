from __future__ import annotations

import argparse
import json
from pathlib import Path
from time import perf_counter

from nwe_compiler.acquisition import acquire_source, nvdb_contract, osm_contract
from nwe_compiler.vector_artifacts import compile_building_artifact, compile_road_artifact, persist_compiled_artifact


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
    return {
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


def main() -> int:
    args = parser().parse_args()
    sources = ("roads", "buildings") if args.source == "all" else (args.source,)
    results = [_one(source, args) for source in sources]
    print(json.dumps({"status": "PASS", "results": results}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
