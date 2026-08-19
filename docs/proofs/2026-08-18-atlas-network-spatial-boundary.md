# 2026-08-18 — ATLAS candidate network spatial boundary

## Scope

This proof advances `P0-COORDINATES-01` from an explicit world↔tile↔render contract toward a simulation/network-safe spatial boundary. It does **not** select a production network protocol, replication topology, prediction model, whole-Norway CRS/index, render-origin threshold, physics engine or production quantization.

The existing authoritative rule remains unchanged: render-local Float32 is presentation state only. Network state is derived from authoritative world positions and uses its own explicit frame identity/epoch.

## Candidate interface

`engine/world/network_state_contract.mjs` defines:

- `NetworkSpatialFrame`: `networkFrameId`, `epoch`, explicit high-precision world anchor and explicit `positionQuantumMeters`;
- `encodeNetworkPosition()` / `decodeNetworkPosition()`: integer offsets relative to the network frame, independent from renderer origin;
- deterministic `nwe.network-spatial-snapshot/0.1-candidate` serialization sorted by entity id;
- strict deserialization and conversion back to world-frame entities;
- fail-closed rejection of stale/foreign network epochs, world-frame mismatches, unknown presentation fields and unsafe quantized integer range.

Horizontal CRS and vertical datum remain separate world-frame fields in the wire schema.

## Adversarial cases

The new 8-case regression exercises:

1. bounded round-trip error for an explicitly configured 0.001 m candidate quantum;
2. byte-identical wire snapshot across 1,000 unrelated render-origin schedules;
3. network-frame rebase changing encoded integers without changing decoded world meaning beyond the declared quantum;
4. stale and foreign network frame/epoch rejection;
5. world-frame/CRS identity mismatch rejection;
6. safe-integer overflow rejection for pathological quantum/range combinations;
7. deterministic entity ordering and world reconstruction;
8. explicit rejection of render-origin fields at both serializer input and snapshot deserialization.

## Local isolated validation

The new module and regression were syntax-checked with Node and the regression was executed in isolation against the same candidate module source before publication:

```text
{"status":"PASS","contract":"nwe.network-spatial-snapshot/0.1-candidate","cases":8,"quantumPolicy":"OPEN","renderOriginAuthority":false}
```

The JSON Schema parses successfully with Python `json.tool`.

Repository-integrated GitHub Actions remains the stronger gate because it executes the new files in the real repository together with the existing world-contract regressions. Exact-head CI should be treated as authoritative for integration status.

## What this proves

- A network spatial representation can be explicitly independent from render-origin identity/epoch while remaining tied to authoritative world coordinates.
- Reframing/rebasing the network encoding can be represented as network-frame metadata rather than physical movement.
- A candidate quantized wire representation can fail closed on frame ambiguity and integer overflow.

## What this does not prove

- `0.001 m` is **not** selected as production network precision. It is only the regression configuration used to measure the half-quantum bound.
- No bandwidth, packet-loss, latency, prediction/reconciliation or multiplayer scalability evidence exists yet.
- No actual physics engine has consumed this boundary yet.
- EPSG:25832 + NN2000 remains the Nannestad prototype instantiation, not whole-Norway policy.
- No render-origin anchor/shift threshold is selected.

## Next gate

Integrate a minimal deterministic simulation/physics adapter that consumes authoritative world state through an independent subsystem-local frame, then serialize snapshots before and after subsystem rebases and render-origin shifts. Measure drift and deterministic replay with moving entities before selecting physics island/rebase or network quantization policy.
