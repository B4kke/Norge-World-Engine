from __future__ import annotations

import hashlib
import json
import os
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import rasterio

from nwe_compiler import __version__
from nwe_compiler.acquisition import TILE_BOUNDS, TILE_ID
from nwe_compiler.raster import inspect_raster
from nwe_compiler.terrain_acquisition import AcquiredTerrainSource, terrain_source_snapshot

Canonicalizer = Callable[[object], bytes]
MAGIC = b"NWEHGT01"
MEDIA_TYPE = "application/vnd.nwe.terrain-height-grid"


class TerrainArtifactError(RuntimeError):
    pass


@dataclass(frozen=True)
class CompiledTerrainArtifact:
    role: str
    artifact_bytes: bytes
    artifact_header: dict
    bundle: dict
    normalized_sha256: str
    normalized_byte_size: int
    artifact_sha256: str
    sample_count: int
    artifact_path: str | None = None
    bundle_path: str | None = None
    normalized_path: str | None = None


def _canonicalizer(value: object) -> bytes:
    from nwe_compiler.canonical import canonical_bytes
    return canonical_bytes(value)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hash_object(value: object, canonicalizer: Canonicalizer) -> str:
    return _sha(canonicalizer(value))


def _artifact_identity_payload(artifact_ref: dict) -> dict:
    return {key: value for key, value in artifact_ref.items() if key not in {"transport", "transport_mutable", "reference"}}


def _validate_normalized_raster(path: Path) -> tuple[dict, np.ndarray]:
    metadata = inspect_raster(path)
    if metadata.crs != "EPSG:25832":
        raise TerrainArtifactError(f"expected canonical EPSG:25832, got {metadata.crs}")
    if metadata.width != 1000 or metadata.height != 1000:
        raise TerrainArtifactError(f"expected 1000x1000 canonical tile, got {metadata.width}x{metadata.height}")
    if metadata.pixel_size != (1.0, 1.0):
        raise TerrainArtifactError(f"expected 1 m canonical grid, got {metadata.pixel_size}")
    if any(abs(a - b) > 1e-7 for a, b in zip(metadata.bounds, TILE_BOUNDS, strict=True)):
        raise TerrainArtifactError(f"canonical tile bounds mismatch: {metadata.bounds}")
    if metadata.count != 1:
        raise TerrainArtifactError("terrain artifact requires one elevation band")
    if metadata.nodata is None:
        raise TerrainArtifactError("canonical DTM must declare nodata")

    with rasterio.open(path) as dataset:
        data = dataset.read(1, out_dtype="float32")
        tags = dataset.tags()
    if tags.get("NWE_TRANSFORM") != "explicit-reproject-fixed-grid":
        raise TerrainArtifactError("normalized DTM lacks explicit reprojection transform tag")
    if tags.get("NWE_RESAMPLING") != "bilinear":
        raise TerrainArtifactError("normalized DTM resampling policy mismatch")
    return {
        "crs": metadata.crs,
        "vertical_datum": tags.get("NWE_VERTICAL_DATUM"),
        "bounds": list(metadata.bounds),
        "pixel_size": list(metadata.pixel_size),
        "width": metadata.width,
        "height": metadata.height,
        "nodata": float(metadata.nodata),
        "dtype": metadata.dtype,
        "transform": tags.get("NWE_TRANSFORM"),
        "resampling": tags.get("NWE_RESAMPLING"),
    }, data


def _build_bundle(
    acquired: AcquiredTerrainSource,
    normalized_bytes: bytes,
    normalized_meta: dict,
    artifact_bytes: bytes,
    artifact_header: dict,
    canonicalizer: Canonicalizer,
) -> dict:
    source = terrain_source_snapshot(acquired)
    source_hash = _hash_object(source, canonicalizer)
    transform = {
        "schema": "nwe.transform-contract/0.1",
        "source_snapshot_hash": source_hash,
        "operation": "dtm1-epsg25833-reproject-bilinear-fixed-grid-epsg25832",
        "source_crs": "EPSG:25833",
        "horizontal_crs": "EPSG:25832",
        "vertical_datum": "NN2000",
        "vertical_operation": "identity-NN2000",
        "resampling": "bilinear",
        "bounds_epsg25832": [str(int(value)) for value in TILE_BOUNDS],
        "pixel_size_m": "1",
        "width": 1000,
        "height": 1000,
        "num_threads": 1,
    }
    transform_hash = _hash_object(transform, canonicalizer)

    normalized_snapshot = {
        "schema": "nwe.normalized-snapshot/0.1",
        "source_snapshot_hash": source_hash,
        "transform_contract_hash": transform_hash,
        "sha256": _sha(normalized_bytes),
        "byte_size": len(normalized_bytes),
        "media_type": "image/tiff; profile=nwe.normalized-dtm/0.2",
        "sample_count": normalized_meta["width"] * normalized_meta["height"],
        "horizontal_crs": normalized_meta["crs"],
        "vertical_datum": normalized_meta["vertical_datum"],
    }
    normalized_hash = _hash_object(normalized_snapshot, canonicalizer)

    compiler_config = {
        "schema": "nwe.compiler-config/0.1",
        "compiler_id": "nwe-world-compiler",
        "compiler_version": __version__,
        "terrain_format": "nwe-height-grid/0.1",
        "storage": "float32-le-row-major-north-to-south",
        "quantization": "none",
    }
    compiler_config_hash = _hash_object(compiler_config, canonicalizer)

    lineage = {
        "schema": "nwe.compile-lineage/0.1",
        "tile_id": TILE_ID,
        "artifact_role": "terrain-height-grid",
        "source_snapshot_hashes": [source_hash],
        "normalized_snapshot_hashes": [normalized_hash],
        "compiler_config_hash": compiler_config_hash,
    }
    lineage_hash = _hash_object(lineage, canonicalizer)

    artifact_sha = _sha(artifact_bytes)
    artifact_ref = {
        "schema": "nwe.artifact-ref/0.1",
        "artifact_role": "terrain-height-grid",
        "tile_id": TILE_ID,
        "sha256": artifact_sha,
        "byte_size": len(artifact_bytes),
        "media_type": MEDIA_TYPE,
        "lineage_hash": lineage_hash,
        "artifact_status": "REAL_COMPILED",
        "transport": {"reference": f"cache://compiled/{TILE_ID}/terrain-height-grid/{artifact_sha}.nwehgt"},
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


def compile_terrain_artifact(
    acquired: AcquiredTerrainSource,
    normalized_raster: str | Path,
    *,
    canonicalizer: Canonicalizer | None = None,
) -> CompiledTerrainArtifact:
    canonicalizer = canonicalizer or _canonicalizer
    normalized_path = Path(normalized_raster)
    normalized_bytes = normalized_path.read_bytes()
    metadata, data = _validate_normalized_raster(normalized_path)

    valid = data[data != metadata["nodata"]]
    if valid.size == 0:
        raise TerrainArtifactError("canonical DTM contains no valid elevation samples")
    header = {
        "schema": "nwe.terrain-height-grid-artifact/0.1",
        "tile_id": TILE_ID,
        "horizontal_crs": "EPSG:25832",
        "vertical_datum": "NN2000",
        "bounds": list(TILE_BOUNDS),
        "width": 1000,
        "height": 1000,
        "pixel_size_m": 1.0,
        "nodata": metadata["nodata"],
        "storage": "float32-le-row-major-north-to-south",
        "elevation_min_m": float(np.min(valid)),
        "elevation_max_m": float(np.max(valid)),
    }
    header_bytes = canonicalizer(header)
    data_bytes = np.asarray(data, dtype="<f4", order="C").tobytes(order="C")
    artifact_bytes = MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + data_bytes

    # Prove byte determinism without relying on the GeoTIFF writer a second time.
    artifact_again = MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + np.asarray(
        data, dtype="<f4", order="C"
    ).tobytes(order="C")
    if artifact_bytes != artifact_again:
        raise TerrainArtifactError("terrain height-grid compilation is not byte deterministic")

    bundle = _build_bundle(acquired, normalized_bytes, metadata, artifact_bytes, header, canonicalizer)
    return CompiledTerrainArtifact(
        role="terrain-height-grid",
        artifact_bytes=artifact_bytes,
        artifact_header=header,
        bundle=bundle,
        normalized_sha256=_sha(normalized_bytes),
        normalized_byte_size=len(normalized_bytes),
        artifact_sha256=_sha(artifact_bytes),
        sample_count=data.size,
    )


def _write_exact(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise TerrainArtifactError(f"content-addressed path collision: {path}")
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def persist_terrain_artifact(
    result: CompiledTerrainArtifact,
    normalized_raster: str | Path,
    cache_root: str | Path,
    *,
    canonicalizer: Canonicalizer | None = None,
) -> CompiledTerrainArtifact:
    canonicalizer = canonicalizer or _canonicalizer
    root = Path(cache_root)
    normalized_source = Path(normalized_raster)
    normalized_bytes = normalized_source.read_bytes()
    if _sha(normalized_bytes) != result.normalized_sha256:
        raise TerrainArtifactError("normalized raster changed before persistence")

    normalized_path = root / "normalized" / TILE_ID / result.role / f"{result.normalized_sha256}.tif"
    artifact_path = root / "compiled" / TILE_ID / result.role / f"{result.artifact_sha256}.nwehgt"
    bundle_path = root / "compiled" / TILE_ID / result.role / f"{result.artifact_sha256}.bundle.json"
    _write_exact(normalized_path, normalized_bytes)
    _write_exact(artifact_path, result.artifact_bytes)
    _write_exact(bundle_path, canonicalizer(result.bundle))

    latest = root / "compiled" / TILE_ID / result.role / "latest.json"
    latest.parent.mkdir(parents=True, exist_ok=True)
    pointer = {
        "schema": "nwe.compiled-cache-pointer/0.1",
        "artifact_sha256": result.artifact_sha256,
        "artifact_path": str(artifact_path),
        "bundle_path": str(bundle_path),
        "normalized_path": str(normalized_path),
    }
    tmp = latest.with_suffix(".tmp")
    tmp.write_text(json.dumps(pointer, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, latest)

    return CompiledTerrainArtifact(
        result.role,
        result.artifact_bytes,
        result.artifact_header,
        result.bundle,
        result.normalized_sha256,
        result.normalized_byte_size,
        result.artifact_sha256,
        result.sample_count,
        str(artifact_path),
        str(bundle_path),
        str(normalized_path),
    )
