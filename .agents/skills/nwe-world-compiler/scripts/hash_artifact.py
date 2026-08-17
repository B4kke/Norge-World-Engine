#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def main() -> int:
    parser = argparse.ArgumentParser(description="Hash one persisted NWE artifact")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()

    path = args.path
    if not path.is_file():
        parser.error(f"not a file: {path}")

    digest, size = sha256_file(path)
    print(json.dumps({"path": str(path), "sha256": digest, "bytes": size}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
