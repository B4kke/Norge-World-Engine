# Preview runtime staging

`stage_preview1_snapshot.py` is the reproducible bridge from authoritative compiler output to the temporary Preview 1 runtime snapshot.

It publishes only content-addressed compiled artifacts + RuntimeVerificationBundles + attribution/manifest metadata. It never publishes raw DTM1/NVDB/OSM responses and rejects raw-source markers, non-compiled transports, unsafe relative paths, SHA mismatches and byte-size mismatches.

The target `preview-runtime` orphan branch is a replaceable P0 transport bridge, not the selected long-term CDN/object-storage architecture.
