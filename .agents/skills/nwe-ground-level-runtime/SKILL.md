---
name: nwe-ground-level-runtime
description: Drives the shortest correct path from verified NWE world artifacts to a walkable ground-level Nannestad vertical slice with terrain, roads, buildings, humanoid locomotion and renderer-neutral state.
---

# NWE Ground-Level Runtime

Use this skill for work that contributes directly to the playable Nannestad milestone.

## Target

The active proof is not a globe viewer. It is a human-scale scene where a person can move through real Nannestad terrain with road/building geometry and a credible first material/lighting pass.

## Execution rule

Read `docs/06-task-queue.md` and take the first open `P0-GROUND-*` task your role can materially advance. Do not skip forward because a later feature looks more interesting.

## World/render separation

- Character/world transform is authoritative and high precision outside Three.js.
- Render-local transform is a derived view relative to the active render origin/epoch.
- Terrain, roads and buildings originate from runtime-verified compiled artifacts.
- Renderer-only fallback height/road width/material detail must never be written back as authoritative world truth.
- A future Unreal adapter must be able to consume the same world/runtime inputs without importing Three.js semantics.

## Minimal playable implementation

Prefer the least complex system that proves the next vertical requirement:
- terrain grounding before full physics;
- third-person camera before elaborate camera modes;
- one licensed humanoid before an asset catalog;
- idle/walk before a large animation state machine;
- batched simple buildings before procedural facade generation;
- road ribbon/surface fallback before full lane engineering;
- bounded shadows/materials before advanced atmospheric systems.

## Acceptance

A task is complete when its queue exit gate passes in the normal viewer, existing truth/provenance boundaries remain intact, and one concise worklog entry records evidence + next task.

Do not add a new harness when the normal viewer can express the same proof.