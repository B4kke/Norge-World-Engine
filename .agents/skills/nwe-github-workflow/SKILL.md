---
name: nwe-github-workflow
description: Enforces safe GitHub branch, commit, PR, CI and project-memory workflow for Norge World Engine. Use when changing repository files, publishing implementation work, responding to review or completing an agent work session.
---

# NWE GitHub Workflow

GitHub er implementasjonsoverflaten. Gjør arbeid reviewbart og reversibelt.

## Før endring

- les `AGENTS.md` og prosjektstatus
- inspect eksisterende branch/diff/PR før du skriver
- ikke overskriv eller stage unrelated work
- opprett normalt `agent/<kort-beskrivelse>` fra oppdatert default branch

## Endringsscope

Hold én PR fokusert på én teknisk hensikt. Ikke bland rendererpynt med compiler-kontrakter, eller refactor med store dataendringer, uten god grunn.

## Commit hygiene

- små, men meningsfulle commits
- commit-melding beskriver utført endring
- aldri credentials/secrets
- ikke commit store rå geodata, caches eller genererte artefakter som kan reproduseres, med mindre en eksplisitt liten fixture er nødvendig

## Valider før push/PR

Kjør relevante:
- tests
- lint/typecheck/build
- skill validator hvis `.agents/skills` endres
- data/fixture verifier
- benchmark når ytelse er del av påstanden

Dokumenter manglende tooling/dependencies; ikke rapporter PASS uten kjøring.

## Pull request

Default er draft PR for agentarbeid med mindre brukeren ber om noe annet.

PR-body skal beskrive:
- hva som endret seg
- hvorfor
- hva som ble bevist
- tester/validering
- risiko/åpne punkter
- neste logiske steg

Ikke merge uten eksplisitt brukerønske.

## Prosjektminne

Før avslutning:
- `docs/05-worklog.md`: faktisk arbeid/bevis
- `docs/06-task-queue.md`: status/neste prioritet
- `docs/04-decisions.md`: bare hvis beslutning/kontrakt faktisk endres
- relevant arkitektur/kildedokument hvis endringen påvirker kontrakten

Avslutt med **Gjort / Bevist / Endret / Neste**.
