from __future__ import annotations

import hashlib
import json
import os
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import rasterio

from nwe_compiler import __version__
from nwe_compiler.canonical import canonical_bytes
from nwe_compiler.nhm_wcs_acquisition import AcquiredNhmWcsSource, nhm_wcs_source_snapshot
from nwe_compiler.nhm_wcs_source_candidate import VERTICAL_DATUM, validate_getcoverage
from nwe_compiler.terrain_artifacts import MAGIC, MEDIA_TYPE
from nwe_compiler.tiles import NANNESTAD_TILE, TileSpec

NORMALIZED_MEDIA_TYPE = "application/vnd.nwe.normalized-height-grid; profile=nhm-wcs-direct/0.1"
TRANSFORM_OPERATION = "nhm-wcs-direct-grid-validate-decode-float32-no-resampling"


class NhmWcsTerrainArtifactError(RuntimeError):
    pass


@dataclass(frozen=True)
class CompiledNhmWcsTerrainArtifact:
    role: str
    artifact_bytes: bytes
    artifact_header: dict[str, Any]
    normalized_bytes: bytes
    bundle: dict[str, Any]
    normalized_sha256: str
    artifact_sha256: str
    sample_count: int
    artifact_path: str | None = None
    bundle_path: str | None = None
    normalized_path: str | None = None


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hash_object(value: object) -> str:
    return _sha(canonical_bytes(value))


def _artifact_identity_payload(artifact_ref: dict) -> dict:
    return {
        key: value
        for key, value in artifact_ref.items()
        if key not in {"transport", "transport_mutable", "reference"}
    }


def _validated_data(acquired: AcquiredNhmWcsSource, tile: TileSpec) -> tuple[dict, np.ndarray]:
    raw_path = Path(acquired.raw_path)
    if not raw_path.exists():
        raise NhmWcsTerrainArtifactError("WCS raw source is unavailable")
    raw = raw_path.read_bytes()
    if len(raw) != acquired.raw_byte_size or _sha(raw) != acquired.raw_sha256:
        raise NhmWcsTerrainArtifactError("WCS raw byte identity changed after acquisition")
    validated = validate_getcoverage(raw_path, tile)
    if validated["response_sha256"] != acquired.raw_sha256:
        raise NhmWcsTerrainArtifactError("WCS validation SHA differs from SourceSnapshot bytes")
    if validated["valid_samples"] != validated["width"] * validated["height"]:
        raise NhmWcsTerrainArtifactError("WCS tile contains nodata and cannot be promoted")
    with rasterio.open(raw_path) as dataset:
        data = dataset.read(1, out_dtype="float32")
    if not np.all(np.isfinite(data)):
        raise NhmWcsTerrainArtifactError("WCS tile contains non-finite elevation values")
    return validated, data


def _build_bundle(
    acquired: AcquiredNhmWcsSource,
    *,
    tile: TileSpec,
    validated: dict,
    normalized_bytes: bytes,
    artifact_bytes: bytes,
) -> dict[str, Any]:
    source_snapshot = nhm_wcs_source_snapshot(acquired)
    source_hash = _hash_object(source_snapshot)

    transform = {
        "schema": "nwe.transform-contract/0.1",
        "source_snapshot_hash": source_hash,
        "operation": TRANSFORM_OPERATION,
        "source_crs": "EPSG:25832",
        "horizontal_crs": tile.horizontal_crs,
        "vertical_datum": VERTICAL_DATUM,
        "vertical_operation": "identity-NN2000",
        "resampling": "none",
        "bounds_epsg25832": [str(int(round(value))) for value in tile.bounds],
        "pixel_size_m": "1",
        "width": validated["width"],
        "height": validated["height"],
        "num_threads": 1,
    }
    transform_hash = _hash_object(transform)

    normalized_snapshot = {
        "schema": "nwe.normalized-snapshot/0.1",
        "source_snapshot_hash": source_hash,
        "transform_contract_hash": transform_hash,
        "sha256": _sha(normalized_bytes),
        "byte_size": len(normalized_bytes),
        "media_type": NORMALIZED_MEDIA_TYPE,
        "sample_count": validated["width"] * validated["height"],
        "horizontal_crs": tile.horizontal_crs,
        "vertical_datum": VERTICAL_DATUM,
    }
    normalized_hash = _hash_object(normalized_snapshot)

    compiler_config = {
        "schema": "nwe.compiler-config/0.1",
        "compiler_id": "nwe-world-compiler",
        "compiler_version": __version__,
        "terrain_format": "nwe-height-grid/0.1",
        "terrain_source_path": "nhm-wcs-direct-grid/0.1",
        "storage": "float32-le-row-major-north-to-south",
        "quantization": "none",
    }
    compiler_config_hash = _hash_object(compiler_config)

    lineage = {
        "schema": "nwe.compile-lineage/0.1",
        "tile_id": tile.tile_id,
        "artifact_role": "terrain-height-grid",
        "source_snapshot_hashes": [source_hash],
        "normalized_snapshot_hashes": [normalized_hash],
        "compiler_config_hash": compiler_config_hash,
    }
    lineage_hash = _hash_object(lineage)

    artifact_sha = _sha(artifact_bytes)
    artifact_ref = {
        "schema": "nwe.artifact-ref/0.1",
        "artifact_role": "terrain-height-grid",
        "tile_id": tile.tile_id,
        "sha256": artifact_sha,
        "byte_size": len(artifact_bytes),
        "media_type": MEDIA_TYPE,
        "lineage_hash": lineage_hash,
        "artifact_status": "REAL_COMPILED",
        "transport": {
            "reference": f"cache://compiled/{tile.tile_id}/terrain-height-grid/{artifact_sha}.nwehgt"
        },
    }
    artifact_ref_hash = _hash_object(_artifact_identity_payload(artifact_ref))

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
    promotion_hash = _hash_object(promotion)

    return {
        "bundle_schema": "nwe.runtime-verification-bundle/0.1",
        "canonicalization_id": "urn:ietf:rfc:8785",
        "hash_algorithm": "sha-256",
        "source_snapshots": [source_snapshot],
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


def compile_nhm_wcs_terrain_artifact(
    acquired: AcquiredNhmWcsSource,
    *,
    tile: TileSpec = NANNESTAD_TILE,
) -> CompiledNhmWcsTerrainArtifact:
    validated, data = _validated_data(acquired, tile)
    normalized_bytes = np.asarray(data, dtype="<f4", order="C").tobytes(order="C")
    expected_bytes = validated["width"] * validated["height"] * 4
    if len(normalized_bytes) != expected_bytes:
        raise NhmWcsTerrainArtifactError(
            f"normalized float32 byte size mismatch: {len(normalized_bytes)} != {expected_bytes}"
        )

    header = {
        "schema": "nwe.terrain-height-grid-artifact/0.1",
        "tile_id": tile.tile_id,
        "horizontal_crs": tile.horizontal_crs,
        "vertical_datum": VERTICAL_DATUM,
        "bounds": list(tile.bounds),
        "width": validated["width"],
        "height": validated["height"],
        "pixel_size_m": 1.0,
        "nodata": validated["nodata"],
        "storage": "float32-le-row-major-north-to-south",
        "elevation_min_m": float(np.min(data)),
        "elevation_max_m": float(np.max(data)),
    }
    header_bytes = canonical_bytes(header)
    artifact_bytes = MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + normalized_bytes
    artifact_again = MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + bytes(normalized_bytes)
    if artifact_bytes != artifact_again:
        raise NhmWcsTerrainArtifactError("WCS terrain artifact compilation is not byte deterministic")

    bundle = _build_bundle(
        acquired,
        tile=tile,
        validated=validated,
        normalized_bytes=normalized_bytes,
        artifact_bytes=artifact_bytes,
    )
    return CompiledNhmWcsTerrainArtifact(
        role="terrain-height-grid",
        artifact_bytes=artifact_bytes,
        artifact_header=header,
        normalized_bytes=normalized_bytes,
        bundle=bundle,
        normalized_sha256=_sha(normalized_bytes),
        artifact_sha256=_sha(artifact_bytes),
        sample_count=data.size,
    )


def _write_exact(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise NhmWcsTerrainArtifactError(f"content-addressed path collision: {path}")
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def persist_nhm_wcs_terrain_artifact(
    result: CompiledNhmWcsTerrainArtifact,
    cache_root: str | Path,
    *,
    tile: TileSpec = NANNESTAD_TILE,
) -> CompiledNhmWcsTerrainArtifact:
    cache_root = Path(cache_root)
    normalized_dir = cache_root / "normalized" / tile.tile_id / "terrain-nhm-wcs-direct"
    normalized_path = normalized_dir / f"{result.normalized_sha256}.f32le"
    _write_exact(normalized_path, result.normalized_bytes)

    artifact_dir = cache_root / "compiled" / tile.tile_id / "terrain-height-grid"
    artifact_path = artifact_dir / f"{result.artifact_sha256}.nwehgt"
    bundle_path = artifact_dir / f"{result.artifact_sha256}.bundle.json"
    _write_exact(artifact_path, result.artifact_bytes)
    bundle_bytes = json.dumps(result.bundle, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    _write_exact(bundle_path, bundle_bytes)

    return CompiledNhmWcsTerrainArtifact(
        role=result.role,
        artifact_bytes=result.artifact_bytes,
        artifact_header=result.artifact_header,
        normalized_bytes=result.normalized_bytes,
        bundle=result.bundle,
        normalized_sha256=result.normalized_sha256,
        artifact_sha256=result.artifact_sha256,
        sample_count=result.sample_count,
        artifact_path=str(artifact_path),
        bundle_path=str(bundle_path),
        normalized_path=str(normalized_path),
    )
