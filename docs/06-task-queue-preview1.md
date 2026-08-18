# Preview 1 branch gate — 2026-08-18

This branch-local queue note avoids falsely advancing the canonical P0 queue before hosted evidence exists.

## P0-PREVIEW1-REAL-01 — Real Nannestad default viewer

**Status:** IMPLEMENTED ON BRANCH / HOSTED REALDATA + VERCEL ACCEPTANCE OPEN  
**Owner area:** `apps/world-viewer`, `tools/preview`, CI/runtime distribution  
**Acceptance:** default Vercel viewer loads one real compiled 1 × 1 km Nannestad tile with verified DTM1 terrain, 246-class NVDB road paths and 135-class OSM building footprints; all three exact artifacts return runtime verification PASS; raw Norwegian source calls remain 0; orbit/zoom works; synthetic fixture is lab-only.  
**Current implementation:** default viewer is fail-closed Preview 1, Forsøk 18 remains `?lab=terrain`, compiled snapshot staging rejects raw/unsafe transports and content mismatches, CI publishes a replaceable orphan `preview-runtime` snapshot only after real compiler + runtime verification + Vite build pass.  
**Open:** exact-head hosted workflow, stable snapshot publication, Vercel preview readback, Android/device measurement.  
**Next after acceptance:** `P0-PREVIEW2-3X3-01` — drive real neighboring tiles through the same scheduler/viewer path; do not create a parallel viewer architecture.
