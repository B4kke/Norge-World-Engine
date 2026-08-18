---
name: nwe-project-start
description: Enforces current Norge World Engine startup, Agent v2 role selection, P0 priority, validation and evidence-backed handoff for every project task.
---

# NWE Project Start

Use this skill for every implementation, research, architecture, benchmark or repository task.

1. Read `AGENTS.md`, `README.md`, `docs/03-roadmap.md`, `docs/04-decisions.md`, `docs/05-worklog.md` and `docs/06-task-queue.md`.
2. Treat GitHub and the current task queue as implementation authority. Use Drive only for referenced long-form history/research.
3. Inspect open branches/PRs/issues that touch the same P0 gate. Do not independently rebuild work already active elsewhere.
4. Select one primary role from `.agents/roles/` and stay inside its ownership unless a cross-role contract change is explicit.
5. Pick the highest-value unresolved P0 task that can produce concrete evidence now.
6. Verify current APIs, package versions, standards, licenses and geodata against primary sources before relying on them.
7. Prefer small reversible changes. Experiments go in `prototypes/`; production-direction code goes in `engine/` only behind accepted contracts/regressions; deployable viewer work goes in `apps/world-viewer`.
8. Run the narrowest relevant tests/build/browser/device benchmark. A plausible visualization, Vercel deploy or hosted timing is not automatically world-truth/device proof.
9. Update `docs/05-worklog.md` and `docs/06-task-queue.md`; update `docs/04-decisions.md` only when evidence changes a decision.
10. Publish by `nwe-github-workflow`.

End with **Gjort / Bevist / Endret / Neste**.
