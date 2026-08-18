from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("preview1_change_gate.sh")


def run(*args: str, cwd: Path) -> dict[str, str]:
    completed = subprocess.run(
        ["bash", str(SCRIPT), *args],
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    fields = dict(line.split("=", 1) for line in completed.stdout.splitlines() if "=" in line)
    if fields.get("heavy") not in {"true", "false"}:
        raise AssertionError(f"invalid gate output: {completed.stdout!r}\n{completed.stderr}")
    return fields


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()


def commit(repo: Path, message: str) -> str:
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-m", message], cwd=repo, check=True, stdout=subprocess.DEVNULL)
    return git(repo, "rev-parse", "HEAD")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="nwe-preview-gate-") as tmp:
        repo = Path(tmp)
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.email", "sentinel@example.invalid"], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.name", "SENTINEL"], cwd=repo, check=True)

        viewer = repo / "apps/world-viewer/runtime.ts"
        viewer.parent.mkdir(parents=True)
        viewer.write_text("export const value = 1;\n", encoding="utf-8")
        base = commit(repo, "base")

        viewer.write_text("export const value = 2;\n", encoding="utf-8")
        code = commit(repo, "runtime change")

        note = repo / "docs/note.md"
        note.parent.mkdir(parents=True)
        note.write_text("cleanup\n", encoding="utf-8")
        head = commit(repo, "cleanup")

        assert run("pull_request", "synchronize", base, head, cwd=repo)["heavy"] == "true"
        assert run("pull_request", "synchronize", code, head, cwd=repo)["heavy"] == "false"

        streaming = repo / "engine/streaming/runtime.mjs"
        streaming.parent.mkdir(parents=True)
        streaming.write_text("export const scheduler = 1;\n", encoding="utf-8")
        streaming_head = commit(repo, "streaming dependency change")
        assert run("pull_request", "synchronize", head, streaming_head, cwd=repo)["heavy"] == "true"

        compiler = repo / "engine/compiler/pipeline.py"
        compiler.parent.mkdir(parents=True)
        compiler.write_text("VALUE = 1\n", encoding="utf-8")
        compiler_head = commit(repo, "compiler dependency change")
        assert run("pull_request", "synchronize", streaming_head, compiler_head, cwd=repo)["heavy"] == "true"

        assert run("pull_request", "synchronize", "", compiler_head, cwd=repo)["heavy"] == "true"
        assert run("pull_request", "opened", "", "", cwd=repo)["heavy"] == "true"
        assert run("push", "", "", "", cwd=repo)["heavy"] == "true"

    print("preview1 change-gate adversarial regressions: PASS")


if __name__ == "__main__":
    main()
