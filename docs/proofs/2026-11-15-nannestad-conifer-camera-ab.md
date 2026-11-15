# 2026-11-15 — Nannestad source-targeted conifer A/B

## Scope and truth

Exact code-bearing commit: `4f4bf4da1631598af5bff3c4027052c085011b22`.
Task: `P1-NEAR-FIELD-TREES-CAMERA-AB`. Branch: `agent/lumen-web-nannestad-1to1` (draft PR #85, not merged).
Two render-only modes `?treeProof=proxy` and `?treeProof=authored` consume the same accepted world artifact, source-backed SR16 representative set and immutable verified CC0 tree transport. Camera position/direction, WebGL2/high profile, clear weather and fixed `2026-07-23T11:00:00Z` sun match.

**Target**: source representative ID `264886deb2d19d0474ee3630`; class spruce; render-local position `[-53.13569641113281,17.832419432468715,-198.15525817871094]`, presentation height 10.2 m. This is a *modeled representative*, **not an observed tree at that physical location**.

**Artifact identities:** accepted terrain `780de19ef1c7911bcf2476def2b91dee078612b11d10ef62923c411c6679bd96`; CC0 source `812f691eb68119681038aed7f45dd80bff0a152afe1fc8160ea5cbeeae9143da`; compiled GLB `77705f017031ac8d7f7a31d78d5b24268eecd56da93bd051cfadee16230be3ba`.

## Accepted evidence

- `preview1-visual-proof` GitHub Actions [run 43724737720](https://github.com/B4kke/Norge-World-Engine/actions/runs/43724737720), job 132844121224: **PASS**.
- [Exact screenshots and comparison artifact](https://github.com/B4kke/Norge-World-Engine/actions/runs/43724737720/artifacts/14165589240) (14-day retention). The standard daylight image, source-tree proxy and authored tree frame are included, along with JSON proof.
- `camera_pose_equal=true`, `source_identity_equal=true`; 817 rendered SR16 representatives in both cases.
- Proxy mode: 0 authored triangles, 0 authored GLB geometry upload and 0 authored draws. Authored mode: 34 selected conifers; 298,928 authored triangles (34 × 8,792), 325,472 estimated mesh-buffer bytes and one near-tree instanced draw candidate.
- Identical centered scene ROI (381 × 431 px), 41,053 sampled pixels: mean absolute RGB delta **3.0637/255**; **4.6988%** changed pixels at >18/255 RGB average difference. The image difference is detectable, but this alone does not prove higher artistic fidelity.
- Browser WebGL2/SwiftShader CPU draw p50: proxy 9.1 ms, authored 4.2 ms. Each window contains only five frame samples with p95 stalls of ~3–4 seconds. **Do not call this a GPU FPS improvement or representative runtime benchmark.**

Other exact-head CI: `world-viewer-vite` 43724737878 PASS, `preview1-realdata-publish` 43724737742 PASS, `baseline` 43724737890 PASS, `viewer-benchmark` 43724737843 PASS. `preview3-realdata-publish` 43724737839 failed due to source NHM WCS HTTP 504; this separate provider gate is not a 1×1 renderer failure.

## Deployment

Vercel project `prj_JsZbBNZ7jEcgGlLnJ3kkn4FxropW`; deployment `dpl_Hf2o4txg4yMQyY2pqj51v3oGRHh8` was independently read back as **READY** for exact code-bearing commit:
https://norge-world-engine-viewer-qkbhsonhx-b4kkes-projects.vercel.app/

Vercel preview still requires SSO under the existing team policy; production was not promoted. The project-level build-skip command now explicitly permits the active PR branch while skipping the `preview-runtime` artifact branch. This fixes repeated CANCELED real-code previews without changing source admission.

## Limitations and next work

This proves that the authored model visibly differs from the proxy at the same source target, not that the forest is photorealistic. A reproducible actual GPU/device moving-camera study and qualitative image review are required before increasing the near radius, draw budget or global asset policy. Preserve DTM/NVDB/OSM/SR16 accepted truth and original per-representative identity.
