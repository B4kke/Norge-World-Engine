# SENTINEL proof — Preview 1 synchronize change gate

**Date:** 2026-08-18  
**Role:** SENTINEL — Integration & QA  
**Target:** `P0-PROVENANCE-02` / Preview 1 publication proof chain  
**Source branch inspected:** `agent/preview1-real-nannestad` at `8e015711f053fd98a4b7f0d970d51fe382f25a0d`

## Strong claim tested

PR #20 states that docs/cleanup-only updates may skip the ~1.1 GB real-data proof, while code/pipeline changes still require the full compile → runtime verification → browser composition proof before publication.

Classification before this SENTINEL run: **NOT PROVEN for multi-commit `pull_request.synchronize` updates.**

## Falsifier

A single synchronize update contains multiple commits:

1. an earlier commit changes a proof-sensitive path such as `apps/world-viewer/**`;
2. the final commit changes only an unrelated docs/cleanup path.

If the change gate inspects only `HEAD^..HEAD`, the full proof can be skipped even though the synchronize update contains a runtime/viewer change.

## Adversarial experiment

A temporary Git repository was created with three commits:

1. base: `apps/world-viewer/runtime.ts`;
2. code change: modifies `apps/world-viewer/runtime.ts`;
3. cleanup: adds only `docs/note.md`.

Observed classifications:

- old gate (`git diff --name-only HEAD^ HEAD`) sees only `docs/note.md` → `heavy=false`;
- correct synchronize range (`base..head`) sees `apps/world-viewer/runtime.ts` and `docs/note.md` → `heavy=true`.

The exact PR #20 workflow at head `8e015711...` independently demonstrated the same last-commit behavior in Actions run `32164960588`: `change-gate` inspected only `.github/workflows/visual-source-probe.yml` from the last commit and `compile-verify-publish` was skipped. That skip was appropriate for that specific update; the defect is that the mechanism cannot distinguish it from the adversarial multi-commit case above.

## Result

**FAIL — the strong claim was falsified.**

This finding does **not** show that `RuntimeVerificationBundle`, WebCrypto/JCS reconstruction, artifact SHA verification, or the existing exact-head browser proofs are invalid. It shows that the CI admission gate could allow a future proof-sensitive update to avoid re-running those proofs.

## Minimal fix

`tools/preview/preview1_change_gate.sh` now evaluates the complete `pull_request.synchronize` `before` → `after` range. It fails closed to `heavy=true` when the event/action is unexpected, SHAs are missing/invalid, commits are unavailable, or the range cannot be diffed.

`tools/preview/test_preview1_change_gate.py` permanently regresses:

- multi-commit code + cleanup range → `heavy=true`;
- cleanup-only range → `heavy=false`;
- missing synchronize range → `heavy=true`;
- opened PR and non-PR events → `heavy=true`.

The regression is wired into the repository baseline as well as the Preview 1 change-gate job.

## Evidence calibration

- **FACT:** the previous workflow used only `HEAD^..HEAD` for synchronize classification.
- **FACT:** the adversarial three-commit history makes that classifier return `heavy=false` while the complete update range contains a proof-sensitive viewer change.
- **FACT:** the replacement regression passes in the local isolated Git fixture.
- **PENDING CI:** hosted baseline execution on the SENTINEL branch/stacked PR is required before the fix itself is called integrated PASS.
- **UNCHANGED:** Android performance/gesture acceptance, real 3×3 terrain seam promotion, and whole-Norway coordinate policy remain separate open gates.
