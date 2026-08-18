from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

SCHEMA_PATH = Path(__file__).with_name("runtime-verification-bundle.schema.json")


def load_schema() -> dict:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return schema


def valid_bundle() -> dict:
    a = "a" * 64
    b = "b" * 64
    c = "c" * 64
    d = "d" * 64
    e = "e" * 64
    f = "f" * 64
    g = "0" * 64
    return {
        "bundle_schema": "nwe.runtime-verification-bundle/0.1",
        "canonicalization_id": "urn:ietf:rfc:8785",
        "hash_algorithm": "sha-256",
        "source_snapshots": [
            {
                "schema": "nwe.source-snapshot/0.3",
                "source_id": "fixture:dtm1",
                "retrieval_identity": {
                    "request_url": "https://example.invalid/dtm1.tif",
                    "query_bounds": ["611000", "6677000", "612000", "6678000"],
                    "tile_id": "epsg25832_611000_6677000_1000m",
                },
                "raw_sha256": a,
                "raw_byte_size": 123,
                "source_crs": "EPSG:25832",
                "source_vertical_datum": "NN2000",
                "z_semantics": "normal_height_m",
                "license_profile": "fixture-only",
                "attribution": "fixture",
                "promotion_state": "VALIDATED_SOURCE",
            }
        ],
        "source_snapshot_hashes": [b],
        "transform_contracts": [
            {
                "schema": "nwe.transform-contract/0.1",
                "source_snapshot_hash": b,
                "operation": "pixel-aligned-window-no-resampling",
                "bounds_epsg25832": ["611000", "6677000", "612000", "6678000"],
                "horizontal_crs": "EPSG:25832",
                "source_crs": "EPSG:25832",
                "vertical_datum": "NN2000",
            }
        ],
        "transform_contract_hashes": [c],
        "normalized_snapshots": [
            {
                "schema": "nwe.normalized-snapshot/0.1",
                "source_snapshot_hash": b,
                "transform_contract_hash": c,
                "sha256": d,
                "byte_size": 456,
                "media_type": "image/tiff; profile=nwe-normalized-dtm",
                "feature_count": 1,
            }
        ],
        "normalized_snapshot_hashes": [e],
        "compiler_config": {
            "schema": "nwe.compiler-config/0.1",
            "compiler_id": "nwe-world-compiler",
            "compiler_version": "0.1.0",
            "terrain_format": "fixture-glb",
        },
        "compiler_config_hash": f,
        "compile_lineage": {
            "schema": "nwe.compile-lineage/0.1",
            "tile_id": "epsg25832_611000_6677000_1000m",
            "artifact_role": "terrain-render",
            "source_snapshot_hashes": [b],
            "normalized_snapshot_hashes": [e],
            "compiler_config_hash": f,
        },
        "lineage_hash": g,
        "artifact_ref": {
            "schema": "nwe.artifact-ref/0.1",
            "artifact_role": "terrain-render",
            "tile_id": "epsg25832_611000_6677000_1000m",
            "sha256": a,
            "byte_size": 777,
            "media_type": "model/gltf-binary",
            "lineage_hash": g,
            "artifact_status": "REAL_COMPILED",
            "transport": {"reference": "cache://compiled/terrain.glb"},
        },
        "artifact_ref_hash": b,
        "promotion_record": {
            "schema": "nwe.promotion-record/0.1",
            "lineage_hash": g,
            "artifact_ref_hash": b,
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
        },
        "promotion_record_hash": c,
    }


def validate(bundle: dict) -> None:
    Draft202012Validator(load_schema()).validate(bundle)


def test_schema_document_and_valid_bundle() -> None:
    validate(valid_bundle())


def test_rejects_non_sha256_shape() -> None:
    bundle = valid_bundle()
    bundle["artifact_ref"]["sha256"] = "not-a-sha"
    with pytest.raises(ValidationError):
        validate(bundle)


def test_rejects_unpromoted_artifact_state() -> None:
    bundle = valid_bundle()
    bundle["artifact_ref"]["artifact_status"] = "NORMALIZED"
    with pytest.raises(ValidationError):
        validate(bundle)


def test_rejects_missing_promotion_gate() -> None:
    bundle = valid_bundle()
    del bundle["promotion_record"]["gates"]["lineage_reconstructed"]
    with pytest.raises(ValidationError):
        validate(bundle)


def test_accepts_legacy_reference_shape_for_verifier_compatibility() -> None:
    bundle = valid_bundle()
    artifact_ref = copy.deepcopy(bundle["artifact_ref"])
    del artifact_ref["transport"]
    artifact_ref["reference"] = "cache://compiled/terrain.glb"
    bundle["artifact_ref"] = artifact_ref
    validate(bundle)


def test_accepts_pr6_terrain_contract_shape() -> None:
    """Keep the schema compatible with the accepted DTM1 terrain producer contract."""
    bundle = valid_bundle()
    source = bundle["source_snapshots"][0]
    source.update(
        {
            "source_crs": "EPSG:25833",
            "pixel_size": ["1", "1"],
            "source_bounds": ["500000", "6670000", "515010", "6685010"],
            "nodata": "-9999",
        }
    )
    source.pop("attribution")

    transform = bundle["transform_contracts"][0]
    transform.update(
        {
            "operation": "dtm1-epsg25833-reproject-bilinear-fixed-grid-epsg25832",
            "source_crs": "EPSG:25833",
            "vertical_operation": "identity-NN2000",
            "resampling": "bilinear",
            "pixel_size_m": "1",
            "width": 1000,
            "height": 1000,
            "num_threads": 1,
        }
    )

    normalized = bundle["normalized_snapshots"][0]
    normalized.pop("feature_count")
    normalized.update(
        {
            "sample_count": 1_000_000,
            "horizontal_crs": "EPSG:25832",
            "vertical_datum": "NN2000",
        }
    )
    validate(bundle)
