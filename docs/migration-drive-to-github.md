# Drive -> GitHub migration snapshot

Date: 2026-08-17

## Migrated implementation artifacts

| Drive artifact | Repository destination | Classification |
|---|---|---|
| `verify_nannestad_source_contracts.py` | `tools/geo/` | verification tool |
| `nannestad_source_contract_proof.json` | `tests/fixtures/` | historical proof fixture |
| `dtm1_atom_adapter_v02.py` | `prototypes/nannestad/compiler/` | legacy prototype; known polygon defect |
| `test_dtm1_atom_adapter_v02.py` | `prototypes/nannestad/compiler/` | legacy baseline test |
| `atom_v02_test_proof.json` | `prototypes/nannestad/compiler/` | historical proof |
| `vektor_runtime_gate_v03.mjs` | `prototypes/nannestad/runtime/` | legacy prototype; known lineage defect |
| `test_vektor_runtime_gate_v03.mjs` | `prototypes/nannestad/runtime/` | legacy baseline test |
| `vektor_runtime_gate_v03_proof.json` | `prototypes/nannestad/runtime/` | historical proof |

## Historical artifacts retained in Drive

The two large one-file browser experiments — **Forsøk 6 Stable Viewer Harness** and **Forsøk 7 One-file HD Imagery** — remain historical Drive/reference artifacts during this bootstrap. They are not CI dependencies and should not become production source-of-truth. New viewer work belongs under `apps/world-viewer/` and should consume compiled runtime artifacts.

Long-form research, decision narratives and the full append-only agent tracklog also remain in Drive. Repo docs summarize current executable status and link responsibilities without duplicating the whole journal.

## Safety note

Migrated prototype files preserve historical behavior for traceability. Their presence in Git does not mean their previously discovered defects are accepted. Promotion into `engine/` requires the ATLAS-04/SENTINEL regressions to pass.
