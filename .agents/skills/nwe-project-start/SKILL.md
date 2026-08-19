---
name: nwe-project-start
description: Enforces current Norge World Engine startup, Agent v2 role selection, P0 priority, validation and evidence-backed handoff for every project task.
---

# NWE Project Start

Use this skill for every implementation, research, architecture, benchmark or repository task.

1. Read `AGENTS.md`, `README.md`, `docs/03-roadmap.md`, `docs/04-decisions.md`, `docs/05-worklog.md`, `docs/06-task-queue.md` and `docs/07-testing-policy.md`.
2. Treat GitHub and the current task queue as implementation authority. Use Drive only for referenced long-form history/research.
3. Inspect open branches/PRs/issues that touch the same P0 gate. Do not independently rebuild work already active elsewhere.
4. Select one primary role from `.agents/roles/` and stay inside its ownership unless a cross-role contract change is explicit.
5. Pick the highest-value unresolved P0 task that can produce concrete evidence now.
6. Verify current APIs, package versions, standards, licenses and geodata against primary sources before relying on them.
7. Prefer small reversible changes. Experiments go in `prototypes/`; production-direction code goes in `engine/` only behind accepted contracts/regressions; deployable viewer work goes in `apps/world-viewer`.
8. Run the narrowest relevant automated tests/build/browser benchmark. Physical-device testing is milestone-based and is required only when the claim is device-specific or automation cannot resolve the blocker; do not routinely ask the user to test Android.
9. Update `docs/05-worklog.md` and `docs/06-task-queue.md`; update `docs/04-decisions.md` only when evidence changes a decision.
10. Publish by `nwe-github-workflow`.

End with **Gjort / Bevist / Endret / Neste**. `Neste` should normally advance engine implementation or an automated evidence gate, not request manual user testing.
