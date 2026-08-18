from __future__ import annotations

import argparse
from pathlib import Path

HEAVY_PREFIXES = (
    "apps/world-viewer/",
    "tools/preview/",
)
HEAVY_EXACT = {
    ".github/workflows/preview1-realdata-publish.yml",
}


def requires_heavy_proof(*, event_name: str, action: str, changed_files: list[str]) -> bool:
    """Return True when Preview 1 real-data/browser proof must run.

    For pull requests, changed_files must describe the complete base...HEAD PR diff,
    not only the latest commit. This is deliberate: with cancel-in-progress enabled,
    a later docs-only commit must not cancel the only heavy proof for an earlier code
    commit and then classify the replacement run as light.
    """
    if event_name != "pull_request":
        return True
    if action in {"opened", "reopened"}:
        return True
    return any(
        path in HEAVY_EXACT or any(path.startswith(prefix) for prefix in HEAVY_PREFIXES)
        for path in changed_files
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Classify whether Preview 1 needs heavy real-data/browser proof")
    parser.add_argument("--event-name", required=True)
    parser.add_argument("--action", default="")
    parser.add_argument("--changed-files", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    changed_files: list[str] = []
    if args.changed_files is not None:
        changed_files = [
            line.strip()
            for line in args.changed_files.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    print("true" if requires_heavy_proof(
        event_name=args.event_name,
        action=args.action,
        changed_files=changed_files,
    ) else "false")


if __name__ == "__main__":
    main()
