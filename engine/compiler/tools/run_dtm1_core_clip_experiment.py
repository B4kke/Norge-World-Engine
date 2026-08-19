from __future__ import annotations

import argparse
import json
from pathlib import Path

from nwe_compiler.dtm1_core_clip_experiment import analyze_core_clip_overlap


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sweep one real DTM1 overlap and test the symmetric border-removal hypothesis."
    )
    parser.add_argument("--source-a", type=Path, required=True)
    parser.add_argument("--source-b", type=Path, required=True)
    parser.add_argument("--inset-px", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    result = analyze_core_clip_overlap(
        args.source_a,
        args.source_b,
        symmetric_inset_px=args.inset_px,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
