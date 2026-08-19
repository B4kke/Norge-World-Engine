# 07 — Testing policy

## Purpose

Norge World Engine must validate aggressively without turning the project owner into a permanent manual test operator. Automated evidence is the default. Physical-device testing is reserved for questions that genuinely require physical hardware or for occasional accumulated milestones.

## Validation hierarchy

Use the cheapest evidence class that is strong enough for the claim being made:

1. Static checks, schemas and syntax validation.
2. Unit, regression, adversarial and deterministic tests.
3. Hosted CI/runtime tests with explicit real-vs-synthetic evidence labels.
4. Desktop/headless browser tests using exact accepted runtime artifacts.
5. Exact-commit deploy/preview smoke tests when deployment behavior matters.
6. Physical-device tests only for device-specific behavior/performance or occasional milestone acceptance.

A higher evidence class is not automatically required for a lower-level claim. For example, a deterministic compiler transform, provenance contract or scheduler state-machine fix does not require an Android run simply because Android is a supported future client.

## Physical-device rule

Physical Android/mobile testing is **milestone-based, batched and infrequent**.

Agents must not make a fresh physical Android test the routine next step after every renderer, streaming or integration change. Before requesting a manual run, the agent must first exhaust available automated tests, CI, browser smoke tests and exact-artifact benchmarks.

A manual device run is justified when at least one of these conditions is true:

- the unresolved claim is inherently device-specific, such as mobile GPU capability, thermal behavior, touch/input behavior, browser/device memory pressure or real mobile frame pacing;
- a major renderer/runtime milestone has accumulated enough changes that one physical run can validate several important questions at once;
- automated evidence is contradictory or cannot reproduce a suspected device-only failure;
- the user explicitly requests a physical-device check.

A manual device run is **not** justified merely because:

- a PR changed renderer or streaming code;
- hosted timing is not identical to mobile timing;
- Android evidence would be “nice to have”;
- the previous manual run is no longer on the newest commit;
- an agent wants the strongest possible evidence before making any progress.

## User-effort budget

Treat manual user interaction as a scarce project resource.

- Batch several device questions into one run.
- Avoid repeating substantially the same test unless a relevant subsystem changed materially or a regression is suspected.
- Never make the user re-run a physical test only to refresh a commit SHA when automated evidence already establishes the changed contract.
- Keep device harnesses reproducible and ready, so milestone checks are short when they are actually needed.
- When a manual run is required, state exactly what cannot be learned without it and what decision the result will unlock.

## Effect on task prioritization

Missing physical-device evidence does not automatically block continued work on:

- world coordinates and origin contracts;
- compiler/geodata correctness;
- provenance and artifact identity;
- tile formats and multi-tile compilation;
- scheduler/cache/lifecycle correctness;
- browser runtime integration already covered by automated exact-artifact tests;
- renderer architecture experiments that can still produce useful hosted/browser evidence.

Device-specific claims must remain correctly labeled as unproven until a milestone device run exists, but the rest of the engine should continue to advance.

## Current cadence

There is no fixed “every N PRs” schedule. The default is **no manual device test**. Trigger one only when accumulated value is high enough or a device-specific question truly blocks a decision.

For the current P0 phase, the priority is advancing the world engine itself: real multi-tile terrain, streaming, world/coordinate contracts, renderer/runtime integration and measurable browser behavior. Physical Android/WebGPU validation remains available as a later checkpoint rather than the automatic next task.
