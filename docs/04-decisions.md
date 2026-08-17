# Decisions

Bare beslutninger eller eksplisitte arbeidskontrakter skal stå her. En idé er ikke «valgt» før konsekvenser og status er dokumentert.

## D-001 — GitHub er implementasjonsoverflaten

**Status:** vedtatt 2026-08-17.

Nye kodeendringer og operative prosjektfiler skal utvikles i GitHub-repoet. Google Drive beholdes som historikk/kunnskapslager under migreringen.

**Konsekvens:** arbeid skal være branch-/diff-/testbart og egnet for PR/CI i stedet for at én HTML-fil fungerer som hele prosjektet.

## D-002 — Repo-lokale Agent Skills under `.agents/skills/`

**Status:** vedtatt for agent-tooling v0.1.

`.agents/skills/` er kanonisk repo-lokasjon fordi den brukes som prosjektsti av flere agentklienter, inkludert Codex/Cursor/GitHub Copilot i det åpne `skills`-økosystemet. Andre klienter kan linke/installere samme skill-set til sin egen prosjektsti.

**Konsekvens:** skills versjoneres med koden, kan reviewes i PR og kan valideres i CI.

## W-001 — Prototype 0 coordinate contract

**Status:** verifisert arbeidshypotese, ikke endelig Norge-arkitektur.

- normalisert horisontal Prototype 0-CRS: EUREF89 / UTM 32N, EPSG:25832
- kanonisk landhøyde når støttet: NN2000
- vertikaldatum lagres eksplisitt; Z uten kjent semantikk/datum er ugyldig
- runtime-origin/floating origin skal være avledet og skal ikke endre world/tile-identitet

## W-002 — `REAL_COMPILED` promotion eies av preprocessing

**Status:** gjeldende kontrakt.

Browser/WCS/Overpass-path kan være diagnostisk eller viewer-harness, men skal ikke være source-of-truth eller kunne promotere til `REAL_COMPILED`. Autoritativ acquisition, hashing, normalisering, clipping, lineage og promotion skal eies av lokal/native eller server-side World Compiler.

## Åpne beslutninger

- landsdekkende koordinat-/indeksstrategi
- Cesium/3D Tiles vs egen Three.js/WebGPU vs hybrid
- endelig runtime tileformat
- eventuell Unreal-runtime
- klient/server/worker/WASM-grense for simulering

Disse skal avgjøres gjennom prototype + måling, ikke preferanse.
