---
name: nwe-github-workflow
description: Enforces safe branch, commit, PR, CI and project-memory workflow for Norge World Engine repository changes.
---

# NWE GitHub Workflow

GitHub is the implementation surface. Inspect current branch/diff/PR first; do not overwrite unrelated work. Keep changes focused and reversible; never commit credentials, raw bulk geodata, caches or reproducible generated tiles.

Validate relevant tests/build/schema/skill checks before PR. Report tooling or infrastructure blocks explicitly instead of calling unexecuted checks PASS.

Default agent publication is a draft PR unless the user asks otherwise. PR body must state what changed, why, evidence/tests, risks/open points and next step. Never merge without explicit user request.

Before handoff update `docs/05-worklog.md` and `docs/06-task-queue.md`; update `docs/04-decisions.md` only for a real decision/contract change.
