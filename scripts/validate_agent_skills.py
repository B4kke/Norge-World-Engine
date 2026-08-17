#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / ".agents" / "skills"
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def parse_frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError("missing opening YAML frontmatter delimiter")
    try:
        _, raw, _ = text.split("---", 2)
    except ValueError as exc:
        raise ValueError("missing closing YAML frontmatter delimiter") from exc
    result: dict[str, str] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        key, sep, value = line.partition(":")
        if not sep:
            raise ValueError(f"invalid frontmatter line: {line!r}")
        result[key.strip()] = value.strip().strip('"')
    return result


def main() -> int:
    errors: list[str] = []
    files = sorted(SKILLS.glob("*/SKILL.md"))
    if not files:
        errors.append("no .agents/skills/*/SKILL.md files found")

    for path in files:
        try:
            meta = parse_frontmatter(path)
            name = meta.get("name", "")
            description = meta.get("description", "")
            if name != path.parent.name:
                errors.append(f"{path}: name {name!r} must match directory {path.parent.name!r}")
            if not NAME_RE.fullmatch(name):
                errors.append(f"{path}: invalid skill name {name!r}")
            if not description:
                errors.append(f"{path}: description is required")
        except Exception as exc:  # validator should report all files, not stop on first
            errors.append(f"{path}: {exc}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"PASS: validated {len(files)} Agent Skills")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
