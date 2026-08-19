#!/usr/bin/env python3
"""Verify deterministic/full and provenance-aware semantic vegetation compilation."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha256(path: str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-a1", required=True)
    parser.add_argument("--artifact-a2", required=True)
    parser.add_argument("--evidence-a1", required=True)
    parser.add_argument("--evidence-a2", required=True)
    parser.add_argument("--evidence-b", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    a1 = load(args.evidence_a1)
    a2 = load(args.evidence_a2)
    b = load(args.evidence_b)
    errors: list[str] = []

    a1_hash = sha256(args.artifact_a1)
    a2_hash = sha256(args.artifact_a2)
    if a1_hash != a2_hash:
        errors.append("same cached normalized source did not produce byte-identical artifact")
    if a1.get("artifact_sha256") != a1_hash or a2.get("artifact_sha256") != a2_hash:
        errors.append("compile evidence artifact hash does not match emitted bytes")
    if a1.get("compiler_config_id") != a2.get("compiler_config_id") or a1.get("compiler_config_id") != b.get("compiler_config_id"):
        errors.append("compiler config identity differs between comparison runs")
    if a1.get("normalized_semantic_sha256") != b.get("normalized_semantic_sha256"):
        errors.append("independent AR50 acquisition changed normalized semantic identity")
    if a1.get("artifact_semantic_sha256") != b.get("artifact_semantic_sha256"):
        errors.append("independent AR50 acquisition changed compiled vegetation semantics")
    if a1.get("representative_instance_count", 0) <= 0 or a1.get("compiled_segment_count", 0) <= 0:
        errors.append("real sample compiled no vegetation representatives")
    modeled = float(a1.get("modeled_tree_count_ge16_over_compiled_area", 0.0))
    represented = float(a1.get("represented_tree_weight_sum", -1.0))
    if abs(modeled - represented) > max(1e-7, abs(modeled) * 1e-12):
        errors.append("representative weights do not preserve modeled >=16cm tree aggregate")

    result = {
        "schema": "nwe.vegetation-representative-verification/0.1",
        "status": "FAIL" if errors else "PASS",
        "errors": errors,
        "same_cache_byte_identical": a1_hash == a2_hash,
        "independent_ar50_semantic_equal": a1.get("artifact_semantic_sha256") == b.get("artifact_semantic_sha256"),
        "artifact_sha256": a1_hash,
        "artifact_semantic_sha256": a1.get("artifact_semantic_sha256"),
        "normalized_semantic_sha256": a1.get("normalized_semantic_sha256"),
        "compiler_config_id": a1.get("compiler_config_id"),
        "compiled_segment_count": a1.get("compiled_segment_count"),
        "representative_instance_count": a1.get("representative_instance_count"),
        "modeled_tree_count_ge16_over_compiled_area": modeled,
        "represented_tree_weight_sum": represented,
    }
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    if errors:
        raise SystemExit("; ".join(errors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
