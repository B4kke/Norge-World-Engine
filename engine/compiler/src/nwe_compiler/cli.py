from __future__ import annotations

import argparse
import json
from pathlib import Path

from nwe_compiler.canonical import CANONICALIZATION_ID, HASH_ALGORITHM, canonical_sha256
from nwe_compiler.raster import inspect_raster, normalize_dtm_clip


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="Normalize a pixel-aligned DTM tile for Norge World Engine")
    command.add_argument("source", type=Path)
    command.add_argument("destination", type=Path)
    command.add_argument("--bounds", nargs=4, type=float, metavar=("LEFT", "BOTTOM", "RIGHT", "TOP"), required=True)
    command.add_argument("--source-vertical-datum", default="NN2000")
    command.add_argument("--manifest", type=Path)
    return command


def main() -> int:
    args = parser().parse_args()
    source_meta = inspect_raster(args.source)
    normalized_meta = normalize_dtm_clip(
        args.source,
        args.destination,
        tuple(args.bounds),
        vertical_datum=args.source_vertical_datum,
    )
    transform_contract = {
        "schema": "nwe.transform-contract/0.1",
        "operation": "pixel-aligned-window-no-resampling",
        "bounds_epsg25832": [str(value) for value in args.bounds],
        "horizontal_crs": "EPSG:25832",
        "vertical_datum": args.source_vertical_datum,
    }
    manifest = {
        "schema": "nwe.normalized-dtm-manifest/0.1",
        "canonicalization_id": CANONICALIZATION_ID,
        "hash_algorithm": HASH_ALGORITHM,
        "source": source_meta.as_dict(),
        "transform_contract": transform_contract,
        "transform_contract_hash": canonical_sha256(transform_contract),
        "normalized": normalized_meta.as_dict(),
        "promotion_state": "NORMALIZED",
        "runtime_ready": False,
    }
    output = args.manifest or args.destination.with_suffix(args.destination.suffix + ".manifest.json")
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"normalized": normalized_meta.as_dict(), "manifest": str(output)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
