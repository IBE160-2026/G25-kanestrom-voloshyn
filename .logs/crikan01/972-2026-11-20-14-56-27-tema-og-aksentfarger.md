# Tema og aksentfarger (V2)

## 2026-11-20 kl. 14:56 — crikan01

### Oppgave
Mens Ihor bygger Epic 4 og 5, og 7.5 venter til de er ferdige, ville Cristoffer legge til en V2-funksjon: temafarger. Han valgte lyst og mørkt tema pluss «Følg systemet», og et valg av aksentfarge. Valget ligger i Innstillinger og lagres på kontoen. Indigo er standard for alle. Han godkjente å gå utenfor PRD §7.2, DESIGN.md og spine; ordlyden i dokumentene foreslås, men endres ikke her.

### Plan
- bmad-build: [spec-theme-options](../../_bmad-output/implementation-artifacts/spec-theme-options.md). En implementeringsagent bygde den, og tre reviewere sjekket den. Rettelsene gikk tilbake til samme agent.

### Resultat
- `68ea722` på `feature/theme-options`:
  - Innstillinger har en ny seksjon, «Utseende», med Følg systemet / Lyst / Mørkt og aksentfargene Indigo, Blå, Fiolett og Cyan. Valget tas i bruk med en gang og lagres i `ui_prefs`, uten migrering.
  - Sider før innlogging følger systemet. Eksisterende kontoer forblir mørke med indigo.
  - En test sjekker WCAG-kontrast for alle kombinasjoner av tema og aksentfarge.
  - QR-ruten er mørk på lys bakgrunn i lyst tema, så telefonkameraer kan lese den.
- Review: 12 funn. 6 ble rettet (full lagring én om gangen, cache glemmes når en økt slutter, tester ved sletting av konto, og opprydding). 6 ble avvist med begrunnelse i specen.
- Tester: backend 844 og frontend 847, alle grønne. Lint er ren. Docker er bygget på nytt. Ingenting er pushet.

### Åpne punkter
- Alle nye tekster i «Utseende» må godkjennes.
- Endringer i de endelige dokumentene må godkjennes og føres inn av Cristoffer eller Ihor: PRD §7.2, DESIGN.md L592, spine L630 og EXPERIENCE.md L21, L75 og L831. Forslaget står i specens Implementation Notes.
- Lyst tema er ikke sjekket manuelt i appen ennå (quiz-tilbakemelding, feillinjer, sidepanel, dialoger).

## 2026-11-20 kl. 15:15 — crikan01

### Oppgave
Cristoffer testet i nettleseren og ba om endringer:
- Lyst tema hadde for lite kontrast; sidepanelet og hovedflaten var nesten like hvite.
- Mørkt skal være mørkere enn standardfargene.
- «Følg systemet» skal bort, og det skal finnes et tema som heter Standard.
- Aksentfargen «Standard» skal være temaets egen aksentfarge.

### Plan
- Endringene ble ført inn som en Amendment i specens Intent og sendt til samme implementeringsagent.

### Resultat
- `b76a1bb` på `feature/theme-options`:
  - Temaene er nå Standard (dagens farger), Lyst og Mørkt (ny, nesten svart).
  - Lyst har grå bakgrunn med hvite paneler og tydeligere linjer (overflate mot bakgrunn 1,20:1).
  - Aksentfargen Standard er temaets egen. Blå, Fiolett og Cyan er faste valg.
  - Lagrede verdier er `default`; gamle `system` og `indigo` leses som Standard.
- Tester: backend 846 og frontend 855, alle grønne. Lint er ren. Docker er bygget på nytt.

### Åpne punkter
- Ingen nye. Tekstene, dokumentendringene og den manuelle sjekken av fargene står allerede i issues.md.
