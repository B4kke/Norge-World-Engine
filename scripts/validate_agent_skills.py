#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / ".agents" / "skills"
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def frontmatter(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing opening YAML frontmatter delimiter")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration as exc:
        raise ValueError("missing closing YAML frontmatter delimiter") from exc

    values: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key in {"name", "description"}:
            values[key] = value
    return values


def main() -> int:
    errors: list[str] = []
    names: set[str] = set()

    if not SKILLS_DIR.is_dir():
        print(f"ERROR: missing {SKILLS_DIR.relative_to(ROOT)}")
        return 1

    skill_files = sorted(SKILLS_DIR.glob("*/SKILL.md"))
    if not skill_files:
        print("ERROR: no project skills found")
        return 1

    for skill_file in skill_files:
        rel = skill_file.relative_to(ROOT)
        dirname = skill_file.parent.name
        try:
            metadata = frontmatter(skill_file.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"{rel}: {exc}")
            continue

        name = metadata.get("name", "")
        description = metadata.get("description", "")

        if not name:
            errors.append(f"{rel}: missing name")
        elif name != dirname:
            errors.append(f"{rel}: name '{name}' must match directory '{dirname}'")
        elif len(name) > 64 or not NAME_RE.fullmatch(name):
            errors.append(f"{rel}: invalid skill name '{name}'")
        elif name in names:
            errors.append(f"{rel}: duplicate skill name '{name}'")
        else:
            names.add(name)

        if not description:
            errors.append(f"{rel}: missing description")
        elif len(description) > 1024:
            errors.append(f"{rel}: description exceeds 1024 characters")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(f"PASS: validated {len(skill_files)} Agent Skills")
    for name in sorted(names):
        print(f" - {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
