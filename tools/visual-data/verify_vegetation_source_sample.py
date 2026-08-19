#!/usr/bin/env python3
"""Verify deterministic/offline vegetation source normalization evidence.

The verifier compares two replays of the same cached bytes and a third replay using the
second independently fetched AR50 response. It never reads provider endpoints.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


def load_json(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"expected JSON object: {path}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--materialization", required=True)
    parser.add_argument("--evidence-a1", required=True)
    parser.add_argument("--evidence-a2", required=True)
    parser.add_argument("--evidence-b", required=True)
    parser.add_argument("--normalized-a1", required=True)
    parser.add_argument("--normalized-a2", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    materialization = load_json(args.materialization)
    a1 = load_json(args.evidence_a1)
    a2 = load_json(args.evidence_a2)
    b = load_json(args.evidence_b)
    bytes_a1 = Path(args.normalized_a1).read_bytes()
    bytes_a2 = Path(args.normalized_a2).read_bytes()

    offline_equal = bytes_a1 == bytes_a2
    evidence_equal = a1["normalized_sha256"] == a2["normalized_sha256"]
    semantic_equal = a1["semantic_sha256"] == b["semantic_sha256"]
    if not offline_equal or not evidence_equal:
        raise RuntimeError("identical cached source bytes did not replay byte-identically")
    if not semantic_equal:
        raise RuntimeError("independent AR50 acquisitions did not normalize to the same semantic hash")

    summary = {
        "schema": "nwe.vegetation-source-sample-gate/0.1",
        "status": "PASS",
        "tile": materialization["target_tile"],
        "normalizer_source_network_required": False,
        "offline_replay_byte_identical": offline_equal,
        "normalized_sha256": hashlib.sha256(bytes_a1).hexdigest(),
        "semantic_sha256": a1["semantic_sha256"],
        "independent_ar50_semantic_equal": semantic_equal,
        "ar50_raw_hashes_equal": materialization["sources"]["ar50"]["raw_hashes_equal"],
        "sr16v": {
            "metadata_uuid": materialization["sources"]["sr16v"]["metadata_uuid"],
            "source_gml_sha256": materialization["sources"]["sr16v"]["cache"]["gml_sha256"],
            "source_gml_bytes": materialization["sources"]["sr16v"]["cache"]["gml_bytes"],
            "normalized_feature_count": a1["layers"]["sr16v"]["stats"]["normalized_feature_count"],
            "normalized_property_names": a1["layers"]["sr16v"]["stats"]["normalized_property_names"],
        },
        "ar50": {
            "raw_acquisition_sha256": [
                item["sha256"] for item in materialization["sources"]["ar50"]["acquisitions"]
            ],
            "normalized_feature_count": a1["layers"]["ar50"]["stats"]["normalized_feature_count"],
            "normalized_property_names": a1["layers"]["ar50"]["stats"]["normalized_property_names"],
        },
        "truth_boundary": "candidate source normalization only; no tree placement/runtime artifact promoted",
    }
    Path(args.output).write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
