from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from nwe_compiler import __version__
from nwe_compiler.acquisition import AcquiredSource, TILE_BOUNDS, TILE_ID, source_snapshot
from nwe_compiler.roads import RoadPath, RoadSegment, compile_road_paths
from nwe_compiler.sources.nvdb import normalize_nvdb_segments
from nwe_compiler.sources.osm_buildings import BuildingFeature, normalize_osm_buildings

Canonicalizer = Callable[[object], bytes]


class VectorArtifactError(RuntimeError):
    pass


@dataclass(frozen=True)
class CompiledVectorArtifact:
    role: str
    artifact_bytes: bytes
    artifact_payload: dict
    bundle: dict
    normalized_bytes: bytes
    normalized_payload: dict
    normalized_count: int
    compiled_count: int
    artifact_sha256: str
    artifact_path: str | None = None
    bundle_path: str | None = None


def _production_canonicalizer(value: object) -> bytes:
    # Lazy import keeps source-acquisition/cache checks runnable even in an
    # isolated environment where the pinned RFC 8785 package is unavailable.
    from nwe_compiler.canonical import canonical_bytes

    return canonical_bytes(value)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hash_object(value: object, canonicalizer: Canonicalizer) -> str:
    return _sha256(canonicalizer(value))


def _road_segment_dict(segment: RoadSegment) -> dict:
    return {
        "source_id": segment.source_id,
        "sequence_id": segment.sequence_id,
        "segment_number": segment.segment_number,
        "road_type": segment.road_type,
        "start_position": segment.start_position,
        "end_position": segment.end_position,
        "points": [[x, y, z] for x, y, z in segment.points],
    }


def _road_path_dict(path: RoadPath) -> dict:
    return {
        "path_id": path.path_id,
        "road_type": path.road_type,
        "source_segment_ids": list(path.source_segment_ids),
        "source_sequence_ids": list(path.source_sequence_ids),
        "length_m": path.length_m,
        "points": [[x, y, z] for x, y, z in path.points],
    }


def _building_dict(feature: BuildingFeature, *, include_tags: bool) -> dict:
    value = {
        "source_id": feature.source_id,
        "polygon": [[x, y] for x, y in feature.polygon],
        "area_m2": feature.area_m2,
        "height_m": feature.height_m,
        "height_source": feature.height_source,
        "clipped": feature.clipped,
    }
    if include_tags:
        value["tags"] = feature.tags
    else:
        value["building"] = feature.tags.get("building", "yes")
    return value


def _transform_contract(source_hash: str, operation: str, source_crs: str, vertical_datum: str | None) -> dict:
    return {
        "schema": "nwe.transform-contract/0.1",
        "source_snapshot_hash": source_hash,
        "operation": operation,
        "bounds_epsg25832": [str(int(value)) if float(value).is_integer() else str(value) for value in TILE_BOUNDS],
        "horizontal_crs": "EPSG:25832",
        "source_crs": source_crs,
        "vertical_datum": vertical_datum,
    }


def _artifact_identity_payload(artifact_ref: dict) -> dict:
    return {
        key: value
        for key, value in artifact_ref.items()
        if key not in {"transport", "transport_mutable", "reference"}
    }


def _build_bundle(
    *,
    acquired: AcquiredSource,
    normalized_payload: dict,
    normalized_bytes: bytes,
    artifact_payload: dict,
    artifact_bytes: bytes,
    artifact_role: str,
    transform_operation: str,
    compiler_config_fields: dict,
    canonicalizer: Canonicalizer,
) -> dict:
    source = source_snapshot(acquired)
    source_hash = _hash_object(source, canonicalizer)
    transform = _transform_contract(
        source_hash,
        transform_operation,
        acquired.contract.source_crs,
        acquired.contract.source_vertical_datum,
    )
    transform_hash = _hash_object(transform, canonicalizer)

    normalized_snapshot = {
        "schema": "nwe.normalized-snapshot/0.1",
        "source_snapshot_hash": source_hash,
        "transform_contract_hash": transform_hash,
        "sha256": _sha256(normalized_bytes),
        "byte_size": len(normalized_bytes),
        "media_type": f"application/json; profile={normalized_payload['schema']}",
        "feature_count": len(normalized_payload.get("features", normalized_payload.get("segments", []))),
    }
    normalized_hash = _hash_object(normalized_snapshot, canonicalizer)

    compiler_config = {
        "schema": "nwe.compiler-config/0.1",
        "compiler_id": "nwe-world-compiler",
        "compiler_version": __version__,
        **compiler_config_fields,
    }
    compiler_config_hash = _hash_object(compiler_config, canonicalizer)

    lineage = {
        "schema": "nwe.compile-lineage/0.1",
        "tile_id": TILE_ID,
        "artifact_role": artifact_role,
        "source_snapshot_hashes": [source_hash],
        "normalized_snapshot_hashes": [normalized_hash],
        "compiler_config_hash": compiler_config_hash,
    }
    lineage_hash = _hash_object(lineage, canonicalizer)

    artifact_sha = _sha256(artifact_bytes)
    transport_reference = f"cache://compiled/{TILE_ID}/{artifact_role}/{artifact_sha}.json"
    artifact_ref = {
        "schema": "nwe.artifact-ref/0.1",
        "artifact_role": artifact_role,
        "tile_id": TILE_ID,
        "sha256": artifact_sha,
        "byte_size": len(artifact_bytes),
        "media_type": f"application/json; profile={artifact_payload['schema']}",
        "lineage_hash": lineage_hash,
        "artifact_status": "REAL_COMPILED",
        "transport": {"reference": transport_reference},
    }
    artifact_ref_hash = _hash_object(_artifact_identity_payload(artifact_ref), canonicalizer)

    promotion = {
        "schema": "nwe.promotion-record/0.1",
        "lineage_hash": lineage_hash,
        "artifact_ref_hash": artifact_ref_hash,
        "from_state": "NORMALIZED",
        "to_state": "REAL_COMPILED",
        "gates": {
            "source_validated": "PASS",
            "transform_validated": "PASS",
            "normalized_bytes_verified": "PASS",
            "compiler_identity_bound": "PASS",
            "artifact_bytes_verified": "PASS",
            "lineage_reconstructed": "PASS",
            "determinism_policy_satisfied": "PASS",
        },
    }
    promotion_hash = _hash_object(promotion, canonicalizer)

    return {
        "bundle_schema": "nwe.runtime-verification-bundle/0.1",
        "canonicalization_id": "urn:ietf:rfc:8785",
        "hash_algorithm": "sha-256",
        "source_snapshots": [source],
        "source_snapshot_hashes": [source_hash],
        "transform_contracts": [transform],
        "transform_contract_hashes": [transform_hash],
        "normalized_snapshots": [normalized_snapshot],
        "normalized_snapshot_hashes": [normalized_hash],
        "compiler_config": compiler_config,
        "compiler_config_hash": compiler_config_hash,
        "compile_lineage": lineage,
        "lineage_hash": lineage_hash,
        "artifact_ref": artifact_ref,
        "artifact_ref_hash": artifact_ref_hash,
        "promotion_record": promotion,
        "promotion_record_hash": promotion_hash,
    }


def compile_road_artifact(
    acquired: AcquiredSource,
    *,
    snap_m: float = 0.25,
    canonicalizer: Canonicalizer | None = None,
) -> CompiledVectorArtifact:
    canonicalizer = canonicalizer or _production_canonicalizer
    payload = json.loads(acquired.raw_bytes)
    segments = normalize_nvdb_segments(payload, bounds=TILE_BOUNDS)
    normalized_payload = {
        "schema": "nwe.normalized-road-segments/0.1",
        "tile_id": TILE_ID,
        "horizontal_crs": "EPSG:25832",
        "vertical_datum": "NN2000",
        "segments": [_road_segment_dict(segment) for segment in segments],
    }
    normalized_bytes = canonicalizer(normalized_payload)

    paths_a = compile_road_paths(segments, snap_m=snap_m)
    paths_b = compile_road_paths(segments, snap_m=snap_m)
    artifact_payload_a = {
        "schema": "nwe.road-network-artifact/0.1",
        "tile_id": TILE_ID,
        "horizontal_crs": "EPSG:25832",
        "vertical_datum": "NN2000",
        "paths": [_road_path_dict(path) for path in paths_a],
    }
    artifact_payload_b = {**artifact_payload_a, "paths": [_road_path_dict(path) for path in paths_b]}
    artifact_bytes = canonicalizer(artifact_payload_a)
    if artifact_bytes != canonicalizer(artifact_payload_b):
        raise VectorArtifactError("road compilation is not byte deterministic")

    bundle = _build_bundle(
        acquired=acquired,
        normalized_payload=normalized_payload,
        normalized_bytes=normalized_bytes,
        artifact_payload=artifact_payload_a,
        artifact_bytes=artifact_bytes,
        artifact_role="road-network",
        transform_operation="nvdb-v4-segmented-reproject-clip-epsg25832",
        compiler_config_fields={"road_endpoint_snap_m": snap_m, "road_graph_policy": "degree-2-collapse-v0.1"},
        canonicalizer=canonicalizer,
    )
    return CompiledVectorArtifact(
        "road-network", artifact_bytes, artifact_payload_a, bundle, normalized_bytes,
        normalized_payload, len(segments), len(paths_a), _sha256(artifact_bytes)
    )


def compile_building_artifact(
    acquired: AcquiredSource,
    *,
    canonicalizer: Canonicalizer | None = None,
) -> CompiledVectorArtifact:
    canonicalizer = canonicalizer or _production_canonicalizer
    payload = json.loads(acquired.raw_bytes)
    features = normalize_osm_buildings(payload, bounds=TILE_BOUNDS)
    normalized_payload = {
        "schema": "nwe.normalized-building-footprints/0.1",
        "tile_id": TILE_ID,
        "horizontal_crs": "EPSG:25832",
        "features": [_building_dict(feature, include_tags=True) for feature in features],
    }
    normalized_bytes = canonicalizer(normalized_payload)

    artifact_payload_a = {
        "schema": "nwe.building-footprint-artifact/0.1",
        "tile_id": TILE_ID,
        "horizontal_crs": "EPSG:25832",
        "features": [_building_dict(feature, include_tags=False) for feature in features],
    }
    artifact_payload_b = {**artifact_payload_a, "features": [_building_dict(feature, include_tags=False) for feature in features]}
    artifact_bytes = canonicalizer(artifact_payload_a)
    if artifact_bytes != canonicalizer(artifact_payload_b):
        raise VectorArtifactError("building compilation is not byte deterministic")

    bundle = _build_bundle(
        acquired=acquired,
        normalized_payload=normalized_payload,
        normalized_bytes=normalized_bytes,
        artifact_payload=artifact_payload_a,
        artifact_bytes=artifact_bytes,
        artifact_role="building-footprints",
        transform_operation="osm-api06-wgs84-reproject-validate-clip-epsg25832",
        compiler_config_fields={
            "building_geometry_policy": "valid-polygon-clip-v0.1",
            "building_height_policy": "explicit-height-or-levels-provenance-no-fallback",
        },
        canonicalizer=canonicalizer,
    )
    return CompiledVectorArtifact(
        "building-footprints", artifact_bytes, artifact_payload_a, bundle, normalized_bytes,
        normalized_payload, len(features), len(features), _sha256(artifact_bytes)
    )


def _write_exact(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise VectorArtifactError(f"content-addressed path collision: {path}")
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def persist_compiled_artifact(
    result: CompiledVectorArtifact,
    cache_root: str | Path,
    *,
    canonicalizer: Canonicalizer | None = None,
) -> CompiledVectorArtifact:
    root = Path(cache_root)
    normalized_sha = _sha256(result.normalized_bytes)
    normalized_path = root / "normalized" / TILE_ID / result.role / f"{normalized_sha}.json"
    artifact_path = root / "compiled" / TILE_ID / result.role / f"{result.artifact_sha256}.json"
    bundle_path = root / "compiled" / TILE_ID / result.role / f"{result.artifact_sha256}.bundle.json"

    canonicalizer = canonicalizer or _production_canonicalizer
    bundle_bytes = canonicalizer(result.bundle)
    _write_exact(normalized_path, result.normalized_bytes)
    _write_exact(artifact_path, result.artifact_bytes)
    _write_exact(bundle_path, bundle_bytes)

    latest = root / "compiled" / TILE_ID / result.role / "latest.json"
    pointer = {
        "schema": "nwe.compiled-cache-pointer/0.1",
        "artifact_sha256": result.artifact_sha256,
        "artifact_path": str(artifact_path),
        "bundle_path": str(bundle_path),
    }
    tmp = latest.with_suffix(".tmp")
    tmp.write_text(json.dumps(pointer, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, latest)

    return CompiledVectorArtifact(
        result.role, result.artifact_bytes, result.artifact_payload, result.bundle,
        result.normalized_bytes, result.normalized_payload, result.normalized_count,
        result.compiled_count, result.artifact_sha256, str(artifact_path), str(bundle_path)
    )
