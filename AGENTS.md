# Norge World Engine — agent instructions

Dette repoet bygges som en langsiktig, målbar grunnmotor. Ikke behandle det som en samling enkelstående HTML-prototyper.

## Før hver oppgave

1. Les `README.md`.
2. Les `docs/03-roadmap.md`, `docs/04-decisions.md`, `docs/05-worklog.md` og `docs/06-task-queue.md`.
3. Les relevante skill-filer i `.agents/skills/` før du implementerer.
4. Velg høyest prioriterte uløste oppgave som faktisk flytter grunnmotoren fremover.
5. Hvis oppgaven avhenger av programvareversjoner, API-er, lisenser eller geodatakilder som kan ha endret seg, bruk `source-driven-development` og verifiser primære/offisielle kilder.
6. Definer et konkret resultat: kode, test, benchmark, pipeline, beslutningsnotat eller dokumentert eksperiment.
7. Gjør små, reversible endringer og valider dem.
8. Oppdater worklog/task queue og eventuelle beslutninger før du avslutter.

## Skill-routing

- All repoarbeid: `.agents/skills/nwe-project-start/SKILL.md`
- Biblioteker/API-er/standarder: `.agents/skills/source-driven-development/SKILL.md`
- Raster/vector/CRS/GDAL: `.agents/skills/gdal/SKILL.md` + `.agents/skills/nwe-geodata-contracts/SKILL.md`
- World Compiler/cache/provenance/promotion: `.agents/skills/nwe-world-compiler/SKILL.md`
- Tester, determinisme, observability, skeptisk QA: `.agents/skills/nwe-quality-gates/SKILL.md`
- Branch/commit/PR/CI/handoff: `.agents/skills/nwe-github-workflow/SKILL.md`

## Ufravikelige prosjektgrenser

- Skill mellom geografisk/geometrisk korrekthet og fotorealisme.
- Rådata skal ikke bli runtime-avhengigheter.
- Browser-fetch/WCS/Overpass kan brukes diagnostisk, men browseren skal ikke promotere artefakter til `REAL_COMPILED`.
- For Prototype 0 er EPSG:25832 en arbeidshypotese for normalisert horisontal CRS; NN2000 beholdes eksplisitt som vertikal referanse når kilden støtter den. Dette er ikke en endelig landsdekkende koordinatbeslutning.
- Z uten kjent semantikk/vertikaldatum er ugyldig; sentinel/manglende Z skal ikke tolkes som ekte høyde.
- Samme source snapshot + transform/config + compiler-versjon skal kunne gi deterministisk output og verifiserbar lineage.
- Viewer/runtime skal lese compiler-output via manifest/artifact references, ikke skjulte råkilder.
- Ikke lås prosjektet til Cesium, Three.js/WebGPU, Unreal eller et tileformat uten målt eksperiment og dokumentert beslutning.
- Ikke commit credentials, proprietære datasett eller store rå geodata.

## Ferdig betyr bevis

En oppgave er ikke ferdig fordi output ser plausibel ut. Oppgi konkret test, hash, måling, source sample, CI-resultat eller annen etterprøvbar evidens.

Avslutt arbeidsøkter kort med: **Gjort / Bevist / Endret / Neste**.
