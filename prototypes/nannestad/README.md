# Nannestad prototypes

This folder preserves executable experiments used to reduce risk around Prototype 0. Code here is not automatically production-ready.

- `compiler/`: SMIA two-stage Atom work and fixtures. v0.2 has a known polygon-as-bbox correctness bug identified by SENTINEL.
- `runtime/`: VEKTOR runtime gate v0.3. It has a known provenance-reconstruction gap identified by SENTINEL.
- `viewer/`: migration note for the historical one-file browser harnesses. The large Forsøk 6/7 HTML files remain in Drive/reference storage and are not production source-of-truth.

Production-direction fixes should be implemented with tests and then promoted/refactored into `engine/` rather than silently rewriting history in place.
