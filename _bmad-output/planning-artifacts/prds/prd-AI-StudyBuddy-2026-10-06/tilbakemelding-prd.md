# Tilbakemelding på PRD

| | |
|---|---|
| **Gruppe** | G25 – G25-kanestrom-voloshyn |
| **PRD vurdert** | `_bmad-output/planning-artifacts/prds/prd-AI-StudyBuddy-2026-10-06/prd.md` (status i frontmatter: final, sist endret 2026-11-02, commit d7ccb31) |
| **Dato** | 2026-11-12 |
| **Type** | Formativ tilbakemelding, ikke karakter |

## 1. Samlet inntrykk

Dette er en gjennomarbeidet PRD med egen tese («last opp én gang, øv på mange måter, gå gjennom det du svarte feil på»), et konsekvent glossar og FR-er med testbare konsekvenser. Risikoen er omfanget: 29 FR-er og ca. 8 700 ord er mye å bygge, teste og dokumentere på ett semester, og PRD-en sier ikke hva som kuttes først. Kravene til KI-delen (kjøring uten nøkkel, hva appen svarer når materialet ikke har svaret, quizformat) er heller ikke like presise som resten.

## 2. Dette fungerer godt

1. **Testbare konsekvenser.** FR-ene har konkrete betingelser dere kan gjøre om til testtilfeller direkte, f.eks. FR-18: «A correct practice answer removes the Mistake from the outstanding count … only after the answer is saved; if saving fails, the Mistake stays outstanding.»
2. **Ærlighet om omfang og konkurranse.** §1 sier at støttefunksjonene gjør V1 større enn briefens «six features», og at «the team accepts that cost knowingly». Dere hevder heller ingen nyhet, og navngir StudyFetch som allerede dekker dette.
3. **Kostnad og innholdsintegritet er krav, ikke ønsker.** §5.2 har en tabell med grenser (20 spørsmål per generering, 50 chatmeldinger og 25 bilder per dag) med begrunnelse, og §5.1 krever «No fabrication» og kildehenvisning på alt generert innhold.

## 3. Oversikt per dimensjon

| Dimensjon | Vurdering | Kort begrunnelse |
|---|---|---|
| Beslutningsklarhet | god | Valg og avveininger er synlige (f.eks. kapring av uverifisert konto i FR-19, §9 «No product decision is outstanding»). Rangering mellom funksjonene mangler. |
| Substans | sterk | Innholdet er produktspesifikt og forankret i egne valg; ingen pynte-personas eller boilerplate-NFR-er. |
| Strategisk sammenheng | god | Tesen er tydelig og Mistake Review binder funksjonene sammen. Kontoer, Google-kobling, QR-opplasting og arkivering trekker i retning av en bredere produktliste. |
| Testbarhet | god | De fleste FR-er er svært gode. Quizformat, svar utenfor materialet og terskler i FR-7 er uavklart, og SM-ene er vanskelige å måle. |
| Scope og avgrensning | god | Non-Goals (§6) og Out of Scope (§7.2) er eksplisitte, men V1 er for stort og uten prioritering. |
| Brukbarhet for neste fase | sterk | Glossar, kontinuerlige ID-er, krysshenvisninger og indeksert antakelsesliste fungerer. Lengden gjør den tung å lese. |
| Formtilpasning | god | UJ-er passer et forbrukerprodukt. Mye av autentiseringen og livssyklusen har ingen UJ og er beskrevet i detalj likevel. |

## 4. Viktigste forbedringer

### 4.1 V1 er for stort og har ingen prioritering
- **Alvorlighet:** høy
- **Hvor:** §7.1 «In Scope» (FR-1–FR-29) og §1 «the team accepts that cost knowingly»
- **Problem og hvorfor det betyr noe:** Tilbakemeldingen på briefen anbefalte 3–4 funksjonsområder og et trinn 1 / trinn 2. PRD-en har vokst i stedet: Google-pålogging med kobling og kapring (FR-19), håndskrift-OCR (FR-7), QR-opplasting fra telefon (FR-21), topic-redigering (FR-22), arkiv og 30-dagers sletting (FR-23, FR-24), to språk (FR-29). Flere av disse (FR-19, 23, 24, 27, 28) er knyttet til Vision, ikke til en brukerreise. Alle FR-er er «V1», så når tiden går ut finnes det ingen avtalt rekkefølge for hva som kuttes.
- **Forslag:** Legg inn en merking per FR i §7.1, f.eks. «Kjerne» eller «Utvidelse». Kjernen kan være FR-1, 2, 4, 6, 10–12, 17, 18 og 25 (last opp → quiz → feil → Mistake Review → historikk). Utvidelse kuttes i denne rekkefølgen: FR-21, FR-7 (håndskrift), FR-19, FR-23/24, FR-29. Da ligger rekkefølgen fast før epics lages.

### 4.2 KI-kontroll og kjøring uten nøkkel er ikke et krav
- **Alvorlighet:** høy
- **Hvor:** §5.1 «No fabrication», FR-11, FR-16, §5.3
- **Problem og hvorfor det betyr noe:** (a) Ingen steder står det at appen skal kunne kjøres og testes uten betalt nøkkel; dette var hovedpunkt 1 i briefe-tilbakemeldingen. (b) FR-16 sier hva svaret aldri skal inneholde, men ikke hva chatten svarer når materialet mangler svaret. (c) Hvordan et quizsvar vurderes (flervalg med ett riktig svar, eller fritekst) står ikke i PRD-en. Det avgjør om retting er enkel kode eller et nytt KI-kall, og om FR-12 kan testes.
- **Forslag:** Nytt FR, f.eks.: «FR-30: Testmodus. En evaluator kan starte appen uten API-nøkkel. Konsekvenser: i testmodus gir Quiz, Flashcards, Summarize, Ask AI og Mistake Review ferdige svar; ingen forespørsel sendes til en ekstern KI-tjeneste; grensene i §5.2 gjelder fortsatt.» Legg til i FR-16: «Når materialet ikke inneholder svaret, sier chatten det og gir ingen faktapåstand; testet med et spørsmål utenfor testdokumentet.» Skriv i FR-11 hvilket quizformat dere har valgt.

### 4.3 FR-7 kan ikke implementeres slik det står
- **Alvorlighet:** medium
- **Hvor:** FR-7 «`[NOTE FOR PM]` … deferred to architecture» og §9 punkt 1
- **Problem og hvorfor det betyr noe:** Notatet sier selv at FR-7 ikke er implementerbart før noen har satt terskler. Det rammer alle formater (§5.1), ikke bare bilder, og flere FR-er (FR-6, FR-21) bygger på de tre utfallene.
- **Forslag:** Sett et startforslag som kan justeres senere: «En side er uleselig når utvinningen gir færre enn 20 ord. Materialet godtas uten varsel når alle sider er leselige, godtas med varsel når 1–50 % er uleselige, og avvises når mer enn 50 % er uleselige.» Test med tre filer i `test-data/`.

### 4.4 Suksessmålene er vanskelige å måle
- **Alvorlighet:** medium
- **Hvor:** SM-2 «share … who start a Mistake Review within 7 days. Target: at least 50%», SM-3 (uten mål), SM-4 «sampled»
- **Problem og hvorfor det betyr noe:** SM-2 krever sporing av atferd over tid, med fem testbrukere og i et prosjekt der analyse er utenfor scope. SM-3 har ingen målverdi. SM-4 sier ikke hvor mange som trekkes ut eller hvem som vurderer. Da kan ikke sensor se om målene er nådd.
- **Forslag:** Gjør SM-4 til en kjørbar sjekk: «Med testdokumentet i `test-data/` genereres 10 spørsmål; minst 9 har en kildehenvisning som faktisk inneholder svaret, kontrollert av to gruppemedlemmer.» Gjør SM-2 til en demo-sjekk («alle 5 testbrukere kan starte Mistake Review fra indikatoren») og sett «alle» som mål for SM-3.

### 4.5 Lengde og begrepsbruk
- **Alvorlighet:** lav
- **Hvor:** §1 «Study Content» / «generated content»; Glossar «Ask AI» og «Chat»
- **Problem og hvorfor det betyr noe:** PRD-en er lang, og noen få begreper glir (se §5). Det er ikke et problem nå, men gjør oppdateringer vanskeligere.
- **Forslag:** Bruk «Study Content» overalt der dere mener Quiz, Flashcards og Summary. Slå «Ask AI» og «Chat» sammen til én regel i glossaret: «Ask AI er funksjonen, Chat er én samtale.»

## 5. Mekaniske funn

- FR-1–FR-29 er kontinuerlige og unike, og antallet stemmer. Rekkefølgen er ikke numerisk i §4 (FR-19–FR-24 ligger i sine funksjonsgrupper), men det er forklart i §0.
- Alle åtte inline `[ASSUMPTION]` står i §10, og alle indeksoppføringer finnes inline.
- Krysshenvisninger mellom FR, UJ, SM og §-er løser seg.
- Små glossaravvik: «generated content» i §1 og §5.1 mot «Study Content»; FR-27 sier at kontoen kan «manage» e-post, mens §7.2 utelukker endring av e-post.
- Alle fem UJ-er har samme hovedperson (Emma). Det fungerer for ett produkt, men gir ingen UJ for pålogging via Google, arkivering eller sletting.
- Ingen sensitive opplysninger funnet.

## 6. Før dere går videre

**Må avklares nå (før videre UX, arkitektur og epics bygges ut):**
- Hvilke FR-er som er kjerne og hvilke som kuttes først (4.1).
- Quizformat og hva chatten svarer når materialet ikke har svaret (4.2).
- Kravet om testmodus uten nøkkel (4.2).
- Terskler i FR-7 (4.3).

**Kan vente:** Presisering av SM-ene (4.4) og glossaropprydding (4.5). Det samme gjelder §9 punkt 2 om personvern hos KI-leverandøren, som arkitekturen eier.

**Oppfølging av briefe-tilbakemeldingen: delvis.**
- Filtyper, filstørrelse (50 MB) og innlogging er avklart (ja).
- Målbare suksesskriterier er i stor grad fulgt opp (kildehenvisning, SM-4 og SM-5), men måleopplegget mangler (delvis).
- Modellvalg, nøkkelhåndtering og testmodus er ikke i PRD-en (nei).
- Forslaget om å dele V1 i to trinn er ikke fulgt; omfanget har vokst (nei).

## 7. Refleksjonsspørsmål

1. Mange av FR-ene (f.eks. kapring av uverifisert konto i FR-19) er svært detaljerte. Hvordan avgjorde dere at dette skulle med i V1, og hvilke deler godtok dere fra KI-forslag uten å spørre hva det koster å bygge og teste?
2. Hvordan kontrollerer dere i praksis at «no fabrication» (§5.1) holder, før noen har skrevet en test? Hvilket dokument og hvilke spørsmål ville dere brukt?

_Vurdert mot kvalitetsrubrikken i bmad-prd. Dette er veiledning, ikke sensur._
