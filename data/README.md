# Data workspace

Raw geodata, normalized datasets, generated tiles and caches are **not committed to Git**.

Expected local/server pipeline roots may include `data/raw/`, `data/normalized/`, `data/compiled/` and `data/cache/`; they are ignored by `.gitignore` and must be reproducible from documented source contracts and compiler configuration.

Small synthetic fixtures/proofs that are safe and useful for deterministic tests belong under `tests/fixtures/` instead.
