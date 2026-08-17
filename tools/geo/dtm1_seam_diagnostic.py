from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from nwe_compiler.seam_diagnostic import (
    SeamDiagnosticError,
    analyze_raw_overlap,
    compare_normalized_sources_to_reference,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure a DTM1 source seam without selecting a seam policy.")
    parser.add_argument("--source-a", type=Path, required=True)
    parser.add_argument("--source-b", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--normalized-a", type=Path)
    parser.add_argument("--normalized-b", type=Path)
    parser.add_argument("--reference", type=Path)
    args = parser.parse_args()

    result: dict[str, Any] = {
        "schema": "nwe.dtm1-seam-diagnostic/0.1",
        "raw_overlap": analyze_raw_overlap(args.source_a, args.source_b),
    }
    comparison_args = (args.normalized_a, args.normalized_b, args.reference)
    if any(value is not None for value in comparison_args):
        if not all(value is not None for value in comparison_args):
            raise SeamDiagnosticError("normalized-a, normalized-b and reference must be supplied together")
        result["reference_comparison"] = compare_normalized_sources_to_reference(
            args.normalized_a, args.normalized_b, args.reference
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
