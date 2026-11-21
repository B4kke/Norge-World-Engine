# Nannestad 1×1 — immutable daylight visual acceptance (2026-11-11)

## Problem and finding

A previous `preview1-visual-proof` job was technically green but showed a nearly
black 3D viewport, because the astronomical sun followed real local midnight.
A separate long-standing blocker made screenshot staging fail: fresh OSM
recompilation produced a different valid building artifact SHA than the
accepted building-height and roof candidate were calibrated against.

Both are *evidence quality* problems, not proof that the world is photorealistic.

## Accepted source frame — fixed, verified, not silently repinned

- Tile: `epsg25832_611000_6677000_1000m`, EPSG:25832 / NN2000.
- Immutable accepted runtime transport commit:
  `a47b8920fb2a72078734cd3fba56c9cafa6344d5`.
- Accepted producing commit:
  `38d151594b0e3a9bae6e4bc9eabd37693c67a597`.
- Terrain SHA-256:
  `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`.
- Road SHA-256:
  `34b9cd4594230df111f4563ee79e6d0a919c1c33be3502dbbcadf1afa5a6db8a`.
- Building SHA-256:
  `678c59603fba2b66d93e7a2252a3c3260a3d80d6a1da0db2c235b9c71423f7cd`.
- Building-derived realism SHA pins and compiler-config IDs are unchanged.

`tools/preview/accepted_world_snapshot.py` downloads *only* the three
content-addressed compiled objects and their complete verifier bundles from
that exact immutable transport commit; rejects manifest producer/tile/role,
path, size, SHA, or bundle inconsistency; then the existing browser/runtime
verifier checks the full provenance chain. It does not consume raw OSM/NVDB
or DTM provider data at runtime.

Normal visual and preview-publish CI use `--base-source accepted` to keep
A/B comparable. `--base-source live` remains an explicit preprocessing
experiment; its changed OSM building artifact MUST fail the existing
derived-realism base SHA gate until a new admitted data-promotion step is
completed.

## Deterministic daytime visual capture

The screenshot path fixes `solarTime=2026-07-23T11:00:00Z` (summer
afternoon in Norway), an **explicit presentation-only clock**.
Ordinary viewer sessions without the query parameter still track live time.
The clock rejects malformed or ambiguous timestamps, reports its mode and
survives per-frame solar updates. The screenshot gate excludes the UI/sidebar
and measures the actual world viewport via Chrome's native Image/Canvas APIs.

## Exact acceptance evidence

On code head `d7e097200240de508f437186490aaae2381762f9`:

- `preview1-visual-proof` run
  [42931242230](https://github.com/B4kke/Norge-World-Engine/actions/runs/42931242230):
  **PASS**, genuine 1440×757 Chrome screenshot, uploaded in the job artifact.
- World-only daylight ROI `[16,92,1020,510]`, 32,640 sampled pixels:
  mean luminance **177.4388/255**; luminance > 45 share **0.9402**.
  Near-black screenshots now fail `VISUAL_PROOF_WORLD_TOO_DARK` rather
  than receiving a false visual PASS.
- `preview1-realdata-publish` run
  [42931242287](https://github.com/B4kke/Norge-World-Engine/actions/runs/42931242287):
  **PASS**, including real Chrome composition and provenance checking.
- `world-viewer-vite` run
  [42931242202](https://github.com/B4kke/Norge-World-Engine/actions/runs/42931242202):
  **PASS**.
- `baseline` run
  [42931242358](https://github.com/B4kke/Norge-World-Engine/actions/runs/42931242358):
  **PASS**.
- `viewer-benchmark` run
  [42931242232](https://github.com/B4kke/Norge-World-Engine/actions/runs/42931242232):
  **PASS**.
- `nvdb-road-semantics-proof` run
  [42931242179](https://github.com/B4kke/Norge-World-Engine/actions/runs/42931242179):
  **PASS**.

## Visual assessment and strict limitations

The daylight screenshot is finally useful for real comparison, but clearly
shows stylized, multi-lobe/low-poly representative trees, plain blocky
buildings and broad dark road surfaces. `REAL WORLD READY` means source
and runtime readiness, **not** photorealistic appearance. The visible
tree crowns and fabricated doors/windows are renderer-only placeholders.
Nothing here validates survey-level roofs or exact trees.

Best next renderer action after this gate: replace near-camera vegetation
proxies with a *small, pinned, CC0, measured-LOD tree asset* mapped from
SR16V class/height, retaining proxy trees as distant fallback. Do not
claim observed individual trees. Roof-specific LoD2 fidelity still needs
exact admitted LiDAR source bytes. Recalibrate road near-field albedo and
junction geometry only against fixed-camera A/B and PBR asset authorship.
