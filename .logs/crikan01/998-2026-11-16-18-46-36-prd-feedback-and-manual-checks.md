# PRD-tilbakemelding og manuelle sjekker

## 2026-11-16 kl. 18:46 — crikan01

### Oppgave
Starte appen lokalt slik at Cristoffer kunne gjøre de manuelle nettlesersjekkene av story 1.1–1.4, og innarbeide alle anbefalingene i Bårds PRD-tilbakemelding (`tilbakemelding-prd.md`).

### Plan
- `npx supabase db reset` + `docker compose up --build`, åpne appen og Mailpit.
- Cristoffer sjekker 1.1–1.4 i nettleseren (punktene fra Ihors issues-liste).
- Oppdatere PRD-en per punkt 4.1–4.5 i tilbakemeldingen, med henvisning til arkitekturen der beslutningen alt fantes (AD-4, AD-6, AD-9).

### Resultat
- **App:** kjører på http://localhost:8000 (mock-modus), Mailpit på http://localhost:54324. Test-e-poster fra backend-testene (`@example.com`) slettet fra Mailpit.
- **Manuelle sjekker (Cristoffer):** 1.1 OK, 1.2 OK, 1.3 OK, 1.4 OK. Tilbakestillings-e-posten (story 1.5) hadde kommet fram, men druknet blant testmailene; den andre forespørselen ga ingen e-post på grunn av 60-sekunders cooldown, som spesifisert.
- **PRD** (`prd.md`, status final, endret med Cristoffers godkjenning; `updated: 2026-11-16`):
  - 4.1: Kjerne/Utvidelse-tabell i §7.1. Kjerne: FR-1, 2, 4, 6, 10–12, 17, 18, 25, 30. Kuttrekkefølge: FR-21 → FR-7 → FR-19 → FR-23/24 → FR-29.
  - 4.2: ny FR-30 Testmodus (samsvarer med AD-4); FR-11 sier flervalg med fire alternativer og ett riktig svar (AD-9); FR-16 sier at chatten sier fra og ikke påstår noe når materialet mangler svaret.
  - 4.3: FR-7, §5.1 og §9.1 peker til tersklene i AD-6.
  - 4.4: SM-2 som demo-sjekk, SM-3 med mål «alle», SM-4 med kjørbar sjekk (9 av 10 med riktig kilde, to kontrollører).
  - 4.5: «Study Content» i §1 og §5.4, egen regel for Ask AI vs Chat i glossaret, FR-27 sier ikke lenger at e-post kan endres.
  - Beslutningen ført i PRD-ens `.memlog.md`.

### Åpne punkter
- FR-30 og den nye FR-16-konsekvensen (chat uten svar i materialet) finnes ikke i spec, akseptkriterier eller epics; de må oppdateres (`bmad-spec` / `bmad-correct-course`), og FR-16-konsekvensen må inn i story 4.4.
- Mappen `test-data/` finnes ikke ennå; FR-7, FR-16, SM-4 og AD-4 forutsetter testfiler der.
- Ihor bør se over PRD-endringene (status final).
- Kodegjennomgang av story 1.1–1.4 (`bmad-code-review`) gjenstår.

## 2026-11-16 kl. 21:40 — crikan01

### Oppgave
Punkt 1 fra forrige økt: oppdatere spec, akseptkriterier og epics med FR-30 og den nye FR-16-konsekvensen, og varsle på telefon ved spørsmål.

### Plan
- Sammenligne PRD-endringene fra Bårds tilbakemelding med `SPEC.md`, `acceptance-criteria.md`, `glossary.md` og `epics.md`, og føre inn det som manglet.

### Resultat
- `SPEC.md`: ny CAP-15 Testmodus (FR-30). CAP-7 sier at chatten sier fra når materialet ikke har svaret. CAP-4 har fire alternativer, scoret uten AI (AD-9). Ny begrensning «Scope tiers» (Kjerne/Utvidelse og kuttrekkefølge). SM-2, SM-3 og SM-4 er oppdatert som i PRD-en (SM-4 med 9/10-sjekken).
- `acceptance-criteria.md`: ny seksjon CAP-15 med FR-30-kriteriene. Ny FR-16-linje, ny FR-11-linje, SM-2/SM-3 lagt til, SM-4 med 9/10-sjekken. FR-29-signeringen er merket som løst.
- `glossary.md`: «Mock mode» = PRDs «Test mode» (FR-30).
- `epics.md`:
  - FR-30 lagt inn i FR-tabellen og dekningskartet (Epic 1 / Story 1.1, pluss mock-fixtures i hver AI-story).
  - Epic 1 dekker FR-30.
  - Ny Given/When/Then i Story 4.4 for spørsmål materialet ikke svarer på.
  - Scope tiers er nå en stående beslutning.
  - Norsk signering er merket som løst, også i Story 7.5.
- `AGENTS.md`: V1 = FR-1 til FR-30.
- Beslutningen er ført i spec-ens `.memlog.md`. Commit `2a04fb3` (ikke pushet).
- Ikke endret: arkitektur-spinen (`status: final`) sier fortsatt «FR-1 to FR-29» i `scope`. FR-30 dekkes allerede av AD-4, så bare scope-linjen må oppdateres, og det krever godkjenning.

### Åpne punkter
- Spinens `scope` sier «FR-1 to FR-29». Spinen er final; endringen til FR-30 må godkjennes (via `bmad-architecture`).
