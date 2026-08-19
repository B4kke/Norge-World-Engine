# ATLAS proof — streaming-aware static collision lifecycle

Date: 2026-08-19  
Gate: `P0-COORDINATES-01`  
Role: ATLAS  
Evidence class: deterministic contract/state-machine regressions

## Question

What must happen when verified static terrain collision is activated, evicted or replaced while a physics island is active?

Static world geometry remains world/tile truth, while solver-local collider state is derived. A streaming cache eviction or artifact replacement must therefore not silently create a physics interval with stale or missing collision.

## Candidate contract

`engine/world/static_collision_lifecycle_contract.mjs` introduces `nwe.static-collision-lifecycle-event/0.1-candidate`.

Events are explicitly ordered at `after-frame-maintenance-before-physics-step`. Each event names the authoritative world frame, exact physics frame + epoch, runtime tile, collision identity and compiled artifact SHA-256. Render-origin state is not admitted.

The candidate state machine distinguishes:

- `ACTIVATE`: verified collision becomes resident for the exact current physics epoch.
- `SET_DEPENDENCIES`: simulation entities explicitly pin the resident collision.
- `EVICT`: permitted only after all dependencies are released.
- `REPLACE`: requires the exact previous artifact identity; if the collision is in use, replacement requires `atomic-rebind` continuity so no missing-collision intermediate state is representable.

This is a contract candidate, not a selected streaming or physics implementation.

## Adversarial evidence

Standalone Node regression passes **10/10** cases:

1. activation targets the current post-maintenance physics epoch;
2. stale epoch fails closed;
3. render-origin leakage fails closed;
4. in-use collision cannot be evicted;
5. dependency identities canonicalize deterministically;
6. in-use replacement without continuity fails closed;
7. atomic replacement preserves continuous residency;
8. replacement must name the exact previous artifact SHA-256;
9. foreign runtime tile replacement fails closed;
10. eviction succeeds only after dependencies are explicitly released.

## Interpretation

A terrain tile being absent from the renderer or ordinary streaming cache is not itself authority to remove collision from an active physics island. Collision residency needs its own simulation-facing lifecycle with explicit dependency release and ordering against physics-frame epoch maintenance.

Likewise, a new compiled terrain artifact cannot silently replace the solver collider while bodies depend on it. Replacement is a semantic transition tied to exact artifact identity and must either be atomic for the dependent simulation set or wait until dependencies are released.

## Claim calibration

**Proven in this evidence class:** the candidate lifecycle representation is deterministic and fails closed on stale epoch, wrong tile, stale artifact identity, presentation-state leakage, unsafe eviction and non-atomic in-use replacement.

**Not proven / still open:**

- how STRØM derives or transports collision residency events;
- how contacts/broadphase state map to `dependentEntityIds`;
- actual Rapier/browser cost of atomic terrain-collider rebuilds;
- terrain collider representation and residency budgets;
- physics backend/precision/island/rebase policy;
- whole-Norway coordinate/indexing policy.

No final policy belongs in `docs/04-decisions.md` from this test.

## Next

Integrate this candidate boundary with the existing terrain tile lifecycle in a narrow adapter/prototype and adversarially prove that renderer/cache deactivation cannot evict collision while simulation dependencies remain, while an artifact replacement is either atomic or blocked before solver mutation.
