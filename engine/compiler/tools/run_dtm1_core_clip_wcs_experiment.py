from __future__ import annotations

import argparse
import json
from pathlib import Path

from nwe_compiler.dtm1_core_clip_wcs_experiment import compare_core_clip_candidates_to_reference


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare all integer DTM1 overlap ownership splits to a provider WCS QA grid."
    )
    parser.add_argument("--source-a", type=Path, required=True)
    parser.add_argument("--source-b", type=Path, required=True)
    parser.add_argument("--normalized-a", type=Path, required=True)
    parser.add_argument("--normalized-b", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--inset-px", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    result = compare_core_clip_candidates_to_reference(
        args.source_a,
        args.source_b,
        args.normalized_a,
        args.normalized_b,
        args.reference,
        symmetric_inset_px=args.inset_px,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
