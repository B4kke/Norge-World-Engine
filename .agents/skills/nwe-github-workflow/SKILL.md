---
name: nwe-github-workflow
description: Enforces isolated Agent v2 branches, draft PRs, CI evidence, Vercel-preview linkage and conflict-aware project-memory updates for Norge World Engine.
---

# NWE GitHub Workflow

GitHub is the implementation surface. Inspect active branches/PRs/issues for the same P0 gate before writing. Do not overwrite or duplicate another agent's work.

Use one primary Agent v2 role per branch. Default branch naming is `agent/<role>-<task>`. Keep core-path ownership narrow; cross-role changes should be versioned contract changes or a clearly documented dependency.

Never commit credentials, raw bulk geodata, caches or reproducible generated runtime tiles. Keep generated proof packages short-lived or outside Git unless intentionally small and licensed.

Run relevant tests/build/schema/skill checks before handoff. Report tooling/infrastructure blocks explicitly instead of calling unexecuted checks PASS.

Default publication is a **draft PR**. PR body states role/owner, task-queue item, what changed, why, evidence/tests, risks/open points, cross-agent dependencies and next step. Never merge without explicit user request.

For LUMEN viewer branches, require a successful production build and obtain/smoke-check a **Vercel Preview** for the exact branch commit when connector/deployment access is available. Record preview URL/deployment identity in the PR or proof note. Preview success is not permission to promote production.

Before handoff update `docs/05-worklog.md` and `docs/06-task-queue.md`; change `docs/04-decisions.md` only for an evidence-backed decision.
