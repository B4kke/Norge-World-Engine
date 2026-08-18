# SENTINEL — Preview 1 proof change-gate adversarial QA

Date: 2026-08-18  
Role: SENTINEL / Integration & QA  
Boundary: `preview1-realdata-publish` exact-head real-data/browser proof gating

## Strong claim tested

Preview 1 states that its latest-commit change gate avoids repeating the expensive DTM proof for unrelated changes while code/pipeline changes still require full proof.

## Falsifier

With `concurrency.cancel-in-progress: true`, use this sequence on one pull request:

1. push a viewer or `tools/preview` code change, starting a heavy proof;
2. before that heavy run finishes, push a later commit that does not touch the heavy path set;
3. the new workflow run cancels the in-progress run;
4. if the replacement run classifies only `HEAD^..HEAD`, it reports `heavy=false` and skips `compile-verify-publish` even though the PR still contains the unproven code change.

## Evidence

**FACT:** PR #20 current head `8e015711f053fd98a4b7f0d970d51fe382f25a0d` ran `preview1-realdata-publish` run `32164960588`; job `change-gate` succeeded while `compile-verify-publish` was **skipped**.

**FACT:** the pre-fix workflow classified pull requests from `git diff --name-only HEAD^ HEAD` and used `cancel-in-progress: true`.

**FACT:** the PR body still described `0e708a543920b8afd25e2328a8e6a6281ac1500d` as the latest mobile-control/test head while the actual PR head had advanced to `8e015711f053fd98a4b7f0d970d51fe382f25a0d`; therefore that exact-head prose was stale.

**EXPERIMENT:** focused local regression for the replacement classifier: `5 passed in 0.05s`. The adversarial case supplies a complete PR diff containing an earlier `apps/world-viewer/...` change plus a later docs change and requires `heavy=true`.

## Minimal fix

- classify the complete pull-request `base...HEAD` file set rather than only the newest commit;
- keep `cancel-in-progress: true`, but make the replacement run inherit the heavy requirement from any still-unmerged Preview-1 code/pipeline change;
- isolate the classifier in `tools/preview/preview1_change_gate.py` with focused regression coverage.

This intentionally prefers redundant expensive proof over a false green. A later optimization may reuse a cryptographically/exact-commit-bound successful proof, but it must not weaken the fail-closed condition.

## Classification

- Pre-fix strongest claim: **FAIL** — heavy proof was not guaranteed after the cancellation sequence.
- Artifact/provenance verifier itself: **NOT INVALIDATED** by this finding; the defect is whether the verifier/browser proof is guaranteed to execute for the relevant PR composition.
- Current Preview-1 real-world correctness on the newest PR head: **NOT PROVEN BY RUN 32164960588**, because its heavy job was skipped.

No renderer, compiler, provenance semantics or world-data authority was changed by this SENTINEL patch.
