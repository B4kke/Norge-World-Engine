# ATLAS streaming → static-collision disposal guard — 2026-08-19

## Gate

`P0-COORDINATES-01` remains open. This proof narrows the boundary between STRØM's renderer-neutral tile lifecycle and ATLAS' simulation-facing static world collision lifecycle.

## Hidden assumption tested

`TileStreamingScheduler` owns runtime payload states (`resident`, `cached`, `idle`) and calls renderer/runtime adapters through `activateTile`, `deactivateTile` and `disposeTile`. Those states are not sufficient authority to decide whether physics collision may disappear.

A static terrain collision can remain required by active simulation entities after renderer deactivation or cache pressure has made the streaming payload eligible for disposal.

## Candidate bridge

`engine/world/static_collision_streaming_guard.mjs` wraps the scheduler's `disposeTile` callback for tiles that have an explicit static-collision binding.

The guard:

- resolves exact `collisionId` + compiled artifact SHA-256 for the streaming payload;
- checks the current authoritative physics frame/epoch;
- requires an explicit authoritative simulation tick rather than deriving time from scheduler generation, wall clock or renderer state;
- preflights `EVICT` through `nwe.static-collision-lifecycle-event/0.1-candidate`;
- refuses disposal while dependent simulation entities pin the collision;
- calls the downstream payload disposal only after lifecycle preflight succeeds;
- commits the collision-lifecycle state only after downstream disposal succeeds, so downstream failure cannot produce split-brain state where physics believes collision is gone while streaming still retains the payload;
- passes unbound/visual-only streaming tiles through without making ATLAS the authority for ordinary cache disposal.

## Adversarial regression

`engine/world/test_static_collision_streaming_guard.mjs` drives the real `TileStreamingScheduler` with one verified-style tile payload and checks seven cases:

1. renderer/runtime deactivation occurs but in-use world collision survives;
2. attempted scheduler eviction fails closed with `COLLISION_IN_USE`, leaving the payload cached;
3. after explicit dependency release, a later scheduler update can evict both payload and collision;
4. stale physics epoch blocks disposal before payload release;
5. artifact identity mismatch blocks downstream mutation;
6. downstream disposal failure leaves collision lifecycle state unchanged;
7. missing simulation-tick authority fails closed; unbound visual-only tiles remain pass-through.

## Interpretation

Streaming/cache state is scheduling state, not world truth. Renderer deactivation is also not collision deactivation. A physics-bound static artifact needs an explicit simulation-side lifecycle decision before scheduler disposal is allowed to remove its backing payload.

The transactional ordering matters: collision lifecycle preflight must happen before downstream disposal, but the authoritative lifecycle commit must happen only after downstream disposal succeeds.

## Non-decisions

This proof does **not** select:

- a production collision residency budget;
- how simulation dependencies are discovered from solver/contact state;
- a terrain collider format;
- a physics backend;
- a physics island extent or rebase threshold;
- a whole-Norway tile/coordinate policy;
- a renderer or GPU resource policy.

`docs/04-decisions.md` remains unchanged.
