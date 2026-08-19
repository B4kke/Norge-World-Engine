# 08 — Revidert motorkjede og skaleringsplan

**Status:** gjennomføringsplan, ikke arkitekturvedtak.  
**Primær bruk:** prioritere neste motorarbeid etter den fungerende Nannestad 3×3-kandidaten.  
**Styrende prinsipp:** geografisk/geometrisk korrekthet og skalerbar runtime kommer før fotorealisme, men materialer/vegetasjon skal introduseres tidlig nok til å gi et tydelig visuelt sprang uten å låse prosjektet til en imagery-lisens.

Denne planen erstatter ikke de evidensbaserte P0-gatene i `docs/06-task-queue.md`. Den beskriver ønsket avhengighetsrekkefølge mellom dem og de neste world-quality-steppene. Faser kan utvikles parallelt når kontraktene tillater det, men en senere fase skal ikke brukes til å skjule en uløst tidligere world-truth- eller runtime-gate.

## Overordnet kjede

1. **3×3 movement-driven residency + budgets**
2. **Terrain LOD/mesh policy på samme scheduler**
3. **Roads + buildings tile-for-tile over hele 3×3**
4. **Building heights/roofs + faktisk road surface**
5. **Første ordentlige material-system + vegetation**
6. **Ortofoto/imagery som tile layer**
7. **Procedural facade/road/terrain detail**
8. **Skalér testområdet fra 3×3 til 10×10 og deretter 25×25 uten lineær RAM/GPU/nettverksvekst**

Parallelt gjennom hele kjeden skal **FORGE + SENTINEL** avslutte spørsmålet om `Atom DTM1 ↔ NHM DTM 25832 WCS` og canonical terrain source. WCS-kandidaten kan brukes til isolert renderer/runtime-evidens der den er eksplisitt merket som kandidat, men dette må ikke presenteres som løst world truth før source-family-transition og acceptance contract er dokumentert og akseptert.

---

## Fase 1 — 3×3 movement-driven residency + budgets

**Mål:** gjøre 3×3-scenen til en faktisk bevegelsesdrevet streamingverden i stedet for et statisk ni-tile showcase.

**Primær owner:** STRØM. LUMEN integrerer renderer-resource lifecycle; SENTINEL falsifiserer accounting/claim-grenser.

**Arbeid:**
- bruk kamera/spillerposisjon til å styre desired/active/retained tiles;
- mål load queue, active loads, cache hits, evictions, aborts og queued streaks;
- håndhev separate, målbare budsjetter for resident/runtime bytes og renderer/GPU payload;
- bevar full RuntimeVerificationBundle-verifikasjon og null raw-source runtime calls;
- test bevegelse gjennom hele 3×3, ikke bare center → east → center;
- integrer/avslutt arbeidet fra STRØM PR #62 uten å velge produksjonsbudsjett fra syntetiske tall alene.

**Exit-gate:** automatisert 3×3 movement-run med bounded concurrency, ingen budsjett-overcommit, dokumentert tile churn/cache-effekt og konsistent renderer-resource lifecycle.

## Fase 2 — Terrain LOD/mesh policy på samme scheduler

**Mål:** koble terrengdetalj til faktisk avstand/skjermbehov og ressursbudsjett.

**Primær owner:** STRØM + LUMEN. FORGE eier bare eventuelle nye compiled derivatives/LOD-artifacts; ATLAS beskytter world/render-origin-kontrakten.

**Arbeid:**
- sammenlign flere mesh-oppløsninger/representasjoner under samme tile identity;
- velg LOD fra målbare kriterier som kameraavstand, projected error/screen coverage og ressursbudsjett;
- mål vertex/triangle count, worker cost, upload, frame time, rAF gaps, retained bytes og GPU bytes;
- test LOD-transition uten world-coordinate drift, sprekker eller skjult endring av authoritative height data;
- hold endelig whole-Norway mesh/3D-Tiles/custom-format åpent til benchmark.

**Exit-gate:** minst to/tre LOD-nivåer kan byttes under bevegelse med dokumentert geometrisk feilbudsjett og lavere ressursbruk enn full-detail-everywhere.

## Fase 3 — Roads + buildings tile-for-tile over hele 3×3

**Mål:** alle world layers følger samme runtime tile identity og residency, slik at 3×3 blir en sammenhengende verden og ikke terreng med én detaljert sentrumscelle.

**Primær owner:** FORGE for compilation; STRØM for multi-layer residency; LUMEN for batching/rendering.

**Arbeid:**
- kompilér NVDB roads og building footprints per 1 km runtime tile;
- behold source snapshot/provenance og offline determinisme per tile;
- definer multi-layer tile bundle/manifest slik at terrain, roads og buildings kan lastes/uavhengig caches uten å blandes med rådata;
- verifiser kantobjekter som krysser tilegrenser uten duplikat/sprekk;
- bevar batching-egenskaper slik at logiske objekter ikke gir lineær draw-call-vekst.

**Exit-gate:** 9/9 tiles kan konsumere terrain + roads + buildings med runtime verification, 0 raw-source calls, korrekt tile-edge-håndtering og målbare draw-call/memory-tall.

## Fase 4 — Building heights/roofs + faktisk road surface

**Mål:** forbedre geometrien før fotorealistiske teksturer legges på den.

**Primær owner:** FORGE. LUMEN visualiserer capability-gated data; SENTINEL kontrollerer at heuristikker ikke blir world truth.

**Buildings:**
- multipolygon/relation-støtte;
- source-backed høyder der tilgjengelig;
- evaluer DOM-DTM som eksplisitt provenance-bearing enrichment;
- evaluer FKB som capability-gated kilde der tilgang/lisens tillater det;
- introduser takform kun når datagrunnlag eller eksplisitt procedural/fallback-policy er tydelig skilt fra authoritative data.

**Roads:**
- skill centerline/topologi fra fysisk vegflate;
- kartlegg bredde/lane/vegkategori/surface-semantikk fra NVDB-kilder som faktisk støtter det;
- generer road surface mesh med eksplisitt transform/provenance;
- senere crossfall/markings skal ikke utledes som «sannhet» fra utilstrekkelige felt.

**Exit-gate:** majoriteten av synlige bygg i testområdet har enten source-backed/enriched høyde eller eksplisitt unresolved/fallback-state, og vegene renderes som provenance-bærende fysiske flater fremfor bare dekorative centerline ribbons.

## Fase 5 — Første ordentlige material-system + vegetation

**Mål:** første store visuelle kvalitetsløft uten avhengighet til full ortofoto-/fasadefotografi-pipeline.

**Primær owner:** LUMEN for renderer/materialsystem; FORGE for klassifiserende world metadata; STRØM for asset/instance residency.

**Materialsystem:**
- separer material-ID/semantic fra renderer-implementasjon;
- støtte minst terrain, road, wall, roof, glass/metal og debug/unresolved;
- bruk PBR-kompatible parametre der det er nyttig, men ikke lås engine-format til én renderer;
- støtte deterministic variation fra stable object/tile ID.

**Vegetation:**
- start med et lite asset-set for norske hovedtyper (for eksempel gran, furu, bjørk/løv);
- deterministic placement fra egnet areal-/vegetasjonsgrunnlag eller eksplisitt procedural testmask;
- GPU instancing nær/mellomdistanse og billigere LOD/impostor langt unna;
- vegetasjon er presentasjon/derived world layer med provenance til grunnlaget, ikke tilfeldig persistent world truth.

**Exit-gate:** 3×3 kan rendres med materialklassifisering og betydelig vegetasjonsmengde innen målte draw-call/frame/memory-budsjetter. Dette er den planlagte første milepælen der webversjonen skal se tydelig annerledes ut, ikke bare være bedre under panseret.

## Fase 6 — Ortofoto/imagery som tile layer

**Mål:** legge imagery på terreng uten å gjøre rå imagery-tjenester til runtime-avhengighet.

**Primær owner:** FORGE for kilde/lisens/preprocessing; STRØM for texture-tile streaming/cache; LUMEN for GPU texture lifecycle/material composition.

**Før implementasjon må følgende være avklart per kilde:**
- dekning og oppløsning;
- CRS og reprojection-policy;
- oppdateringsfrekvens;
- lisens, attribution, cache- og redistribution-rettigheter;
- nedlastings/API-metode;
- egnethet for preprocessing og runtime.

**Pipeline:** source snapshot → normalisert imagery → tile pyramid/mips → komprimert runtime texture artifact → provenance verification → texture residency.

**Exit-gate:** minst 3×3 imagery er deterministisk/reproduserbart preprocessert og streames som runtime tiles med dokumentert lisensmodell, cold/warm bytes, cache, GPU memory og first-visible-cost.

## Fase 7 — Procedural facade/road/terrain detail

**Mål:** øke nærkvalitet uten unike fotografiske assets for hvert objekt.

**Primær owner:** LUMEN + FORGE/tooling.

**Arbeid:**
- procedural vindus-/fasademønstre basert på building semantics og stable seeds;
- roof/wall material variation;
- road markings, shoulder/edge detail og normal/roughness-variasjon;
- terrain detail blending, macro/micro variation og avstandsbasert detail suppression;
- hold alle derived/procedural lag reproducerbare fra stable input + compiler/material config.

**Exit-gate:** nærscene har gjenkjennelig detalj og variasjon uten eksplosjon i unique textures, draw calls eller asset bytes.

## Fase 8 — 10×10 → 25×25 skaleringsgate

**Mål:** bevise at arkitekturen kan vokse utover 3×3 uten at RAM, GPU-memory, nettverk og load latency følger total world size lineært.

**Primær owner:** STRØM + LUMEN; FORGE produserer testområdet; ATLAS validerer koordinat/origin; SENTINEL kontrollerer benchmark-validitet.

**Trinn A:** 10×10 km / 100 runtime tiles.  
**Trinn B:** 25×25 km / 625 runtime tiles.

**Målinger:**
- resident/runtime RAM;
- GPU resource bytes;
- disk/browser cache;
- network bytes cold/warm;
- tile queue/admission latency;
- first-visible og movement hitching;
- worker utilization;
- draw calls / triangle/instance counts;
- frame p50/p95/p99 og største rAF-gap;
- cache hit/eviction/churn over en fast kamerarute.

**Krav:** ressursbruk skal primært følge den aktive/retained working set, ikke total antall tiles i testområdet. Dersom 25×25 bare «fungerer» ved å holde hele verden resident, har skaleringsgaten feilet.

---

## Parallell gate — canonical terrain source: Atom DTM1 ↔ WCS

**Owner:** FORGE + SENTINEL.

Renderer/runtime-arbeidet skal ikke blokkeres av at source-family-spørsmålet fortsatt er åpent, så lenge candidate data er eksplisitt merket og aldri promoted som canonical world truth. Samtidig skal WCS-kandidaten ikke snike seg inn som valgt produksjonskilde bare fordi den gir sømløse 3×3-bilder.

Gate lukkes først når vi har en dokumentert, evidensbasert kontrakt for én av følgende:
- Atom DTM1 med autoritativ behandling av 15 km nominal domain / 15010 px overlap-bufferen; eller
- eksplisitt overgang til WCS/source family med dokumentert dataproveniens, datum, determinisme, service-/cache-/bulk-egnethet og en ny acceptance contract som erstatter eller reviderer D-007 uten å late som artifact identity er uendret.

`docs/04-decisions.md` skal bare endres når denne overgangen faktisk er bevist og valgt.

## Prioriteringsregel mellom fasene

- Fase 1 er aktiv høyeste runtime-prioritet og overlapper direkte med STRØM PR #62.
- Fase 2 kan starte på syntetiske/aksepterte tiles før source-family-gaten er lukket, men ingen whole-Norway LOD-policy velges uten større-world evidence.
- Fase 3 kan utvikle vector multi-tile parallelt med terrain-source-arbeidet fordi roads/buildings har egne source contracts.
- Fase 4 bør lande før fotorealistisk facade/road imagery, slik at vi ikke teksturerer feil geometri.
- Fase 5 kommer bevisst **før** full imagery. Det gir stort visuelt utbytte med liten lisens- og texture-data-lock-in.
- Fase 6 må fail-close på lisens/cache/redistribution før den blir en produksjonsavhengighet.
- Fase 8 er ikke «last hele området». Den er beviset på at tile/LOD/residency-arkitekturen faktisk skalerer.

## Hva planen ikke velger

Denne planen velger ikke:
- WCS eller Atom som canonical whole-Norway terrain source;
- konkrete RAM/VRAM/cache-budsjetter;
- konkrete LOD-avstander eller mesh-oppløsninger;
- WebGPU vs WebGL2 vs Cesium/3D Tiles som endelig renderer/runtime;
- production imagery provider;
- FKB som obligatorisk kilde;
- unik fotorealistisk fasade for hvert bygg.

Slike valg krever egne målte eksperimenter og eventuelt nye entries i `docs/04-decisions.md`.

## Neste konkrete arbeid

1. SENTINEL/STRØM: ferdigstill og falsifiser multi-tile resource-pressure/movement-harnesset fra PR #62 på siste `main`.
2. STRØM/LUMEN: bruk samme harness som grunnlag for første terrain-LOD benchmark.
3. FORGE: etabler vector compilation/indexing for alle ni runtime tiles uten å vente på terrain source-family-beslutningen.
4. FORGE/SENTINEL parallelt: fortsett canonical terrain source-gaten til den kan lukkes med faktisk provider/source evidence.
