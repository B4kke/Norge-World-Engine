---
name: nwe-reuse-discipline
description: Prevents NWE agents from reinventing mature infrastructure or entering repeated research/test loops by requiring reuse checks, explicit exit gates and evidence-triggered rework.
---

# NWE Reuse & Stop Discipline

Use this skill on architecture, renderer, streaming, simulation, asset and tooling tasks where custom infrastructure or repeated investigation is tempting.

## Before custom implementation

Ask in this order:
1. Is the capability already in the repo?
2. Is there a mature library/standard already selected or appropriate for the problem?
3. Can a thin adapter satisfy NWE's contract?
4. What NWE-specific requirement prevents reuse?

Generic raster/CRS/topology/canonicalization/mesh optimization/asset loading/animation/render primitives are not where NWE should differentiate unless a measured mismatch exists.

Document the mismatch before building a custom replacement.

## Anti-loop rule

Each task needs one explicit exit gate before implementation.

After the exit gate passes, stop. Additional optimization/research requires at least one of:
- a failed metric/budget;
- a reproducible regression;
- a changed product requirement;
- a newly discovered correctness/security/license issue;
- evidence that the reused solution cannot meet the contract.

Repeatedly running substantially identical browser/device tests without changed code/claim is not progress.

## Investigation rule

Do not recursively research a source/API/license/standard question unless it blocks the active task. Record non-blocking uncertainty in the task queue and continue with already accepted inputs.

For a blocking unknown:
- prefer current primary/official sources;
- identify the exact decision the research will unlock;
- stop once enough evidence exists to make or reject that decision.

## Prototype rule

New work belongs in `prototypes/` only when it isolates a genuinely uncertain choice. If the normal viewer/engine can host the proof safely, implement it there instead of creating another side harness.

Do not maintain two competing prototypes for the same question once one has answered it; archive the superseded path.

## QA rule

Use the smallest evidence set that can falsify the claim:
- targeted unit/regression for local logic;
- one integration/browser smoke for the composed behavior;
- physical device only for device-specific claims or a batched milestone.

SENTINEL gets one cheap adversarial pass per dangerous new boundary. A second pass needs a new failure or materially changed implementation.

## Handoff

End with the structured `docs/05-worklog.md` entry. `Next` must be one task, not a list of everything still imaginable.