#!/usr/bin/env python3
"""Compile a normalized vegetation source sample into a deterministic candidate artifact.

This is a compiler-side evidence tool. It reads only already-normalized local bytes,
performs no provider/network access, writes RFC8785/JCS artifact bytes and emits a
small evidence JSON. Raw provider data remains outside Git and outside the output.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from nwe_compiler.canonical import canonical_bytes, canonical_sha256
from nwe_compiler.vegetation import VegetationRepresentativeConfig, compile_vegetation_representatives


def semantic_payload(artifact: dict) -> dict:
    payload = dict(artifact)
    input_binding = dict(payload["input_binding"])
    input_binding.pop("source_raw_bindings", None)
    payload["input_binding"] = input_binding
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--representatives-per-hectare", type=float, default=16.0)
    args = parser.parse_args()

    source_path = Path(args.input)
    source_bytes = source_path.read_bytes()
    normalized = json.loads(source_bytes.decode("utf-8"))
    config = VegetationRepresentativeConfig(
        representative_target_per_hectare=args.representatives_per_hectare,
    )
    artifact = compile_vegetation_representatives(normalized, config=config)
    artifact_bytes = canonical_bytes(artifact)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(artifact_bytes)

    evidence = {
        "schema": "nwe.vegetation-representative-compile-evidence/0.1",
        "status": "PASS",
        "source_network_required": False,
        "candidate_not_promoted": True,
        "normalized_input_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "normalized_semantic_sha256": artifact["input_binding"]["normalized_semantic_sha256"],
        "compiler_config_id": artifact["compiler_config_id"],
        "artifact_sha256": hashlib.sha256(artifact_bytes).hexdigest(),
        "artifact_semantic_sha256": canonical_sha256(semantic_payload(artifact)),
        "artifact_byte_size": len(artifact_bytes),
        "compiled_segment_count": artifact["stats"]["compiled_segment_count"],
        "representative_instance_count": artifact["stats"]["representative_instance_count"],
        "eligible_area_m2": artifact["stats"]["eligible_area_m2"],
        "ar50_suppressed_area_m2": artifact["stats"]["ar50_suppressed_area_m2"],
        "semantic_skipped_area_m2": artifact["stats"]["semantic_skipped_area_m2"],
        "modeled_tree_count_ge16_over_compiled_area": artifact["stats"]["modeled_tree_count_ge16_over_compiled_area"],
        "represented_tree_weight_sum": artifact["stats"]["represented_tree_weight_sum"],
        "sampling_representative_point_fallbacks": artifact["stats"]["sampling_representative_point_fallbacks"],
    }
    evidence_path = Path(args.evidence)
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
