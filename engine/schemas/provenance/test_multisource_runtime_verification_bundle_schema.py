from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

SCHEMA_PATH = Path(__file__).with_name("runtime-verification-bundle.schema.json")


def validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def mosaic_bundle() -> dict:
    hashes = [f"{digit}" * 64 for digit in "123456789abcdef"]
    source_a, source_b, transform_hash, normalized_hash, config_hash, lineage_hash, artifact_hash = hashes[:7]
    artifact_ref_hash, promotion_hash = hashes[7:9]
    source_hashes = sorted([source_a, source_b])
    sources = []
    for index, source_hash in enumerate(source_hashes):
        sources.append(
            {
                "schema": "nwe.source-snapshot/0.3",
                "source_id": f"kartverket:hoyde-dtm1:{index}",
                "raw_sha256": source_hash,
                "raw_byte_size": 1000 + index,
                "source_crs": "EPSG:25833",
                "source_vertical_datum": "NN2000",
                "z_semantics": "normal_height_m",
                "pixel_size": ["1", "1"],
                "source_bounds": ["275000", "6670000", "290000", "6685000"],
                "nodata": "-32767",
                "license_profile": "CC-BY-4.0",
                "promotion_state": "VALIDATED_SOURCE",
            }
        )
    return {
        "bundle_schema": "nwe.runtime-verification-bundle/0.1",
        "canonicalization_id": "urn:ietf:rfc:8785",
        "hash_algorithm": "sha-256",
        "source_snapshots": sources,
        "source_snapshot_hashes": source_hashes,
        "transform_contracts": [
            {
                "schema": "nwe.transform-contract/0.1",
                "source_snapshot_hashes": source_hashes,
                "operation": "dtm1-source-mosaic-reproject-bilinear-fixed-grid-epsg25832",
                "source_crs": "EPSG:25833",
                "horizontal_crs": "EPSG:25832",
                "vertical_datum": "NN2000",
                "vertical_operation": "identity-NN2000",
                "mosaic_source_count": 2,
                "mosaic_overlap_policy": "require-match-before-reproject",
                "mosaic_overlap_tolerance_m": "0.0",
                "resampling": "bilinear",
                "bounds_epsg25832": ["611000", "6676000", "612000", "6677000"],
                "pixel_size_m": "1",
                "width": 1000,
                "height": 1000,
                "num_threads": 1,
            }
        ],
        "transform_contract_hashes": [transform_hash],
        "normalized_snapshots": [
            {
                "schema": "nwe.normalized-snapshot/0.1",
                "source_snapshot_hashes": source_hashes,
                "transform_contract_hash": transform_hash,
                "sha256": normalized_hash,
                "byte_size": 12345,
                "media_type": "image/tiff; profile=nwe.normalized-dtm/0.2",
                "sample_count": 1_000_000,
                "horizontal_crs": "EPSG:25832",
                "vertical_datum": "NN2000",
            }
        ],
        "normalized_snapshot_hashes": [normalized_hash],
        "compiler_config": {
            "schema": "nwe.compiler-config/0.1",
            "compiler_id": "nwe-world-compiler",
            "compiler_version": "0.1.0",
            "terrain_format": "nwe-height-grid/0.1",
        },
        "compiler_config_hash": config_hash,
        "compile_lineage": {
            "schema": "nwe.compile-lineage/0.1",
            "tile_id": "epsg25832_611000_6676000_1000m",
            "artifact_role": "terrain-height-grid",
            "source_snapshot_hashes": source_hashes,
            "normalized_snapshot_hashes": [normalized_hash],
            "compiler_config_hash": config_hash,
        },
        "lineage_hash": lineage_hash,
        "artifact_ref": {
            "schema": "nwe.artifact-ref/0.1",
            "artifact_role": "terrain-height-grid",
            "tile_id": "epsg25832_611000_6676000_1000m",
            "sha256": artifact_hash,
            "byte_size": 4_000_382,
            "media_type": "application/vnd.nwe.terrain-height-grid",
            "lineage_hash": lineage_hash,
            "artifact_status": "REAL_COMPILED",
            "transport": {"reference": "cache://compiled/mosaic.nwehgt"},
        },
        "artifact_ref_hash": artifact_ref_hash,
        "promotion_record": {
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
        },
        "promotion_record_hash": promotion_hash,
    }


def test_accepts_strict_two_source_mosaic_contract() -> None:
    validator().validate(mosaic_bundle())


def test_rejects_transform_with_both_singular_and_plural_source_refs() -> None:
    bundle = mosaic_bundle()
    bundle["transform_contracts"][0]["source_snapshot_hash"] = bundle["source_snapshot_hashes"][0]
    with pytest.raises(ValidationError):
        validator().validate(bundle)


def test_rejects_normalized_snapshot_without_any_source_ref() -> None:
    bundle = mosaic_bundle()
    del bundle["normalized_snapshots"][0]["source_snapshot_hashes"]
    with pytest.raises(ValidationError):
        validator().validate(bundle)


def test_rejects_unversioned_mosaic_policy_field() -> None:
    bundle = mosaic_bundle()
    bundle["transform_contracts"][0]["mosaic_seam_magic"] = "pick-newest"
    with pytest.raises(ValidationError):
        validator().validate(bundle)
