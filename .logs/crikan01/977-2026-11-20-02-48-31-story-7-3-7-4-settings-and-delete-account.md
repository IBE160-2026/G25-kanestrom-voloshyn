# Story 7.3a og 7.4: innstillinger og slett konto (nattkjøring)

## 2026-11-20 kl. 02:48 — crikan01

### Oppgave
Nattkjøring uten tilsyn, startet 02:11 slik Cristoffer ba om. Den skulle bygge Story 7.3 (Innstillinger) og deretter 7.4 (Slett kontoen min).
Cristoffer bestemte på forhånd:
- «Endre passord» krever det nåværende passordet, sjekket på serveren.
- Det nye passordet skrives to ganger.

### Plan
- 7.3 var for stor til én spec og ble delt i to:
  - [spec-7-3a-settings-page.md](../../_bmad-output/implementation-artifacts/spec-7-3a-settings-page.md) ble bygget.
  - 7.3b (Koble til Google-konto og Send bekreftelseslenken på nytt) er ført i deferred-work.md.
- [spec-7-4-delete-my-account.md](../../_bmad-output/implementation-artifacts/spec-7-4-delete-my-account.md).
- Specene ble godkjent på Cristoffers vegne bare for denne nattkjøringen. Alle beslutningene og den nye teksten er merket «pending Cristoffer's approval».
- Hver story ble bygget av en implementeringsagent og gjennomgått av tre reviewere.
  - 7.3a: 19 funn, 9 rettet, 1 venter på Cristoffers beslutning.
  - 7.4: 14 funn, 8 rettet, 1 utsatt.

### Resultat
- `06dd572` (7.3a), på grenen `feature/7-3-settings`:
  - `/settings` med Konto, Språk og Dataene dine. «Innstillinger» er første valg i kontomenyen.
  - Navnet kan endres direkte for e-postkontoer. For Google-kontoer kan det bare leses.
  - Endre passord: `POST /api/me/password/check` sjekker det nåværende passordet, og deretter setter nettleseren det nye med `updateUser`.
  - Under Dataene dine er det en liste over prosjektene med en Slett-knapp på hvert.
- `02894ee` (7.4), på grenen `feature/7-4-delete-account`, laget fra 7.3a:
  - `DELETE /api/me` gjør dette i rekkefølge:
    1. Stopper jobbene og venter på dem.
    2. Sletter de lagrede filene.
    3. Sletter brukeren i Supabase Auth, slik at alle tabellene slettes med den.
    4. Går over de lagrede filene én gang til.
  - Dialogen krever at man skriver DELETE eller SLETT. Etterpå vises «Kontoen din og filene dine er slettet.» på innloggingssiden.
- Tester: backend 815, frontend 774, lint ren.
- Docker er bygget på nytt fra `feature/7-4-delete-account`. Ingenting er pushet eller merget.

### Åpne punkter
- 7.3a, beslutning (a): sjekken av det nåværende passordet beskytter bare skjemaet. Den som allerede er logget inn, kan likevel endre passordet direkte, og andre enheter forblir innlogget. Alternativet er at serveren setter passordet og logger ut alle andre enheter. Cristoffer må velge.
- 7.3a: godkjenn den nye teksten:
  - feltnavnene Nåværende/Nytt/Gjenta nytt passord
  - «Passordene er ikke like.», «Det er ikke det nåværende passordet ditt.», «Skriv inn det nåværende passordet ditt.» og «Det nye passordet må være forskjellig …»
  - «For mange forsøk …»
  - innledningslinjene for seksjonene, hentet fra mockupen
  - feilene name_from_google og no_password
- 7.4: godkjenn beslutning (a), rekkefølgen, (b), at DELETE/SLETT må skrives nøyaktig, og (c), knappen «Slett kontoen min».
- 7.4: hvis man sletter kontoen og registrerer seg på nytt med samme e-post, nullstilles dagens grenser. Ingen passordsjekk før kontoen slettes; det følger EXPERIENCE.md.
- Story 7.3b, Koble til Google-konto og Send bekreftelseslenken på nytt, er ikke bygget. Ved kobling må fornavnet også settes fra Google.
- Alle Supabase-innlogginger sendes fra serverens ene IP-adresse, så alle studentene deler samme grense. Ført i deferred-work.md.
- Hvis slettingen av de lagrede filene feiler under kontosletting, blir filene liggende. Det har samme årsak som punktet fra 7.2b.

## 2026-11-20 kl. 12:21 — crikan01

### Oppgave
Cristoffer testet i nettleseren: «Innstillinger» skulle ikke ta ham til en egen side, men åpne som et overlegg, og et klikk utenfor skulle ta ham tilbake dit han var.

### Plan
- Gjøre Settings om til en Radix-dialog over siden man står på, og fjerne ruten `/settings`.
- Oppdatere testene og føre endringen inn som en Amendment i [spec-7-3a](../../_bmad-output/implementation-artifacts/spec-7-3a-settings-page.md).

### Resultat
- `9b93cb3` på `feature/7-4-delete-account`:
  - Settings åpnes fra kontomenyen som et overlegg. Klikk utenfor, Esc eller × lukker det, siden bak er uendret, og fokus går tilbake til kontomenyen.
  - Esc i et endret navnefelt angrer endringen i stedet for å lukke.
  - Når profilen ikke lastes, vises feilen inne i overlegget.
  - Slettedialogene legger seg over overlegget.
- Nye tester for de tre måtene å lukke på. Frontend: 777 tester grønne, lint ren. Docker er bygget på nytt.

### Åpne punkter
- EXPERIENCE.md L75 («Settings: one page») og DESIGN.md L657 (tittelen «Settings» i toppfeltet) er final og sier fortsatt at det er en side. Forslaget til ny tekst står i spec-7-3a under Amendments; Cristoffer eller Ihor fører det inn.
