# Provenance schema contracts

This directory versions the structural contract consumed by the runtime provenance gate without changing compiler, tile, viewer or renderer behavior.

## `runtime-verification-bundle.schema.json`

The schema captures the currently implemented object versions:

- `nwe.source-snapshot/0.3`
- `nwe.transform-contract/0.1`
- `nwe.normalized-snapshot/0.1`
- `nwe.compiler-config/0.1`
- `nwe.compile-lineage/0.1`
- `nwe.artifact-ref/0.1`
- `nwe.promotion-record/0.1`
- `nwe.runtime-verification-bundle/0.1`

JSON Schema enforces structure, version identifiers, SHA-256 string shape, allowed promotion states and the complete PASS gate set. It intentionally does **not** replace `engine/streaming/runtime_verifier.mjs`.

The runtime verifier remains authoritative for semantic/cross-object checks that JSON Schema cannot establish by structure alone, including:

- RFC 8785 canonical hash reconstruction;
- equality between declared and reconstructed hashes;
- reference-edge integrity across snapshots/lineage/artifact/promotion;
- artifact byte-size/SHA verification;
- raw-source transport rejection;
- transport relocation exclusion from immutable artifact identity;
- deterministic promotion semantics.

`compilerConfig` deliberately permits artifact-specific configuration keys beyond the required compiler identity/version fields. Other component objects are closed over their currently implemented 0.x fields so accidental contract drift is visible.

## Validation

The isolated schema workflow pins `jsonschema==4.26.0` and runs the narrow regression suite in this directory. This dependency is test-only and is not added to the World Compiler or runtime dependency surface.
