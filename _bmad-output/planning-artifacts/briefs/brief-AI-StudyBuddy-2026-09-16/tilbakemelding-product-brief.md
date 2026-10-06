# Tilbakemelding på product brief

| | |
|---|---|
| **Gruppe** | G25 – G25-kanestrom-voloshyn |
| **Product brief** | `_bmad-output/planning-artifacts/briefs/brief-AI-StudyBuddy-2026-09-16/brief.md` (commit 64151f7) |
| **Tilbakemelding fra** | Faglærer i IBE160 (utarbeidet med KI-støtte) |
| **Dato** | 2026-10-06 |

## Samlet vurdering

- **Godt utgangspunkt med justeringer.** Gruppen kan gå videre og innarbeide punktene under.

**Det som er bra:**

1. Briefen er tydelig og godt strukturert. Kjerneflyten «last opp én gang, øv på mange måter, gå gjennom det du svarte feil på» er lett å forstå, og Mistake Review gjør at appen henger sammen i stedet for å være seks løse funksjoner.
2. Dere er ærlige om konkurrentene (NotebookLM, Quizlet, StudyFetch med flere) og om at differensieringen ligger i enkelhet og sammenheng, ikke i nyhet. Lista over hva som er ute av v1 (spaced repetition, analyse, adaptiv læring) er også god.

**De viktigste endringene:**

1. Planlegg hvordan appen bruker en språkmodell uten at sensor trenger deres nøkkel: hvilken modell, hvor nøkkelen ligger (`.env`, aldri i repoet), og en testmodus med ferdige mock-svar. Alle de seks funksjonene er avhengige av dette.
2. Gjør suksesskriteriene testbare. «Generated content must stay relevant» og «simple enough to use without instruction» kan ikke sjekkes slik de står. Beskriv for eksempel at hvert quizspørsmål viser hvilken del av dokumentet det bygger på, og at quizen alltid har et bestemt antall spørsmål med ett riktig svar.
3. Avklar filhåndtering og lagring: hvilke filtyper (bare PDF og tekst i v1?), maksimal størrelse, og om Saved Projects betyr innlogging eller lagring lokalt for én bruker.

## Vanskelighetsgrad og gjennomførbarhet

### Vurdert vanskelighetsgrad

- **Middels**

**Sammenlignbart med:** 1) AI Study Buddy (enkel) er utgangspunktet. Med Ask AI (spørsmål forankret i dokumentet, i retning av 7) Kurs-FAQ-chatbot), Mistake Review og Saved Projects havner v1 i nedre del av middels.

**Begrunnelse:**

| Faktor | Nivå (lav / middels / høy) | Kommentar |
|---|---|---|
| Domenelogikk – hvor mange og hvor kompliserte regler og beregninger må stemme? | Lav–middels | Quizretting og logikken for Mistake Review (hva lagres, når regnes en feil som rettet, hvordan lages ny øving) må defineres. Resten styres av språkmodellen. |
| Datamodell – antall entiteter og relasjoner mellom dem | Middels | Prosjekt, dokument, quiz, spørsmål, svar/forsøk, flashcards, sammendrag og feilhistorikk. Mange entiteter knyttet til samme prosjekt. |
| Brukere, roller og innlogging | Lav–middels | Én brukertype. Uklart om Saved Projects krever innlogging. Uten innlogging er dette enkelt. |
| KI-funksjonalitet i appen, f.eks. kall til språkmodell, prompts i koden og håndtering av usikre svar | Høy | Fire ulike KI-funksjoner (quiz, flashcards, sammendrag, Ask AI) med hver sine prompts, strukturert utdata (JSON for quiz) og krav om at svarene holder seg til dokumentet. |
| Integrasjoner og eksterne tjenester, f.eks. API-er, betaling og e-post | Middels | Avhengig av et eksternt LLM-API med nøkkel og kostnad. |
| Sanntid, samtidighet eller flere brukere som påvirker hverandre | Lav | Ingen sanntid. |
| Filhåndtering, f.eks. opplasting, PDF-lesing og eksport | Middels | Opplasting og tekstuttrekk fra PDF og lysbilder. Lysbilder og skannede PDF-er gir ofte dårlig tekst. Store dokumenter kan overstige modellens kontekstvindu. |
| Sikkerhet og personvern | Lav–middels | Opplastet materiale sendes til en ekstern KI-tjeneste. Nevn dette, og bruk eget testmateriale uten opphavsrettslige problemer i repoet. |

**Hva vanskelighetsgraden betyr for dere:**

- _Middels:_ Et godt balansert valg. Pass på at kjerneflyten blir ferdig og stabil før dere legger til mer. For dere betyr det: last opp → generer quiz → ta quizen → se feilene i Mistake Review. Få denne flyten stabil før Flashcards, Summarize og Ask AI.

### Gjennomførbarhet med BMAD og Claude Code

Dere skal planlegge med BMAD (product brief → PRD → arkitektur → epics og stories) og implementere med Claude Code. Vurderingen under tar hensyn til at det må være tid til hele denne flyten, og til testing, retting og README til slutt.

| Spørsmål | Vurdering (OK / risiko / stor risiko) | Kommentar |
|---|---|---|
| **Tid og omfang** – kan v1 realistisk bli ferdig og stabil i løpet av semesteret, med tid til flere iterasjoner? | Risiko | Seks funksjoner er mer enn de 3–4 funksjonsområdene vi anbefaler for v1. De deler mye infrastruktur (opplasting og LLM-kall), men hver trenger egne prompts, skjermbilder og tester. Git-loggen viser ennå ingen PRD. |
| **BMAD-flyten** – er briefen konkret nok til at PRD, arkitektur og stories kan lages uten store hull, og blir det overkommelig mange stories? | OK | Funksjonene er tydelig navngitt og avgrenset, så PRD og epics kan bygges direkte på dem. Mistake Review og Saved Projects trenger mer presise regler. |
| **Egnet for Claude Code** – bruker løsningen en vanlig, godt dokumentert teknologistakk som Claude Code håndterer godt, eller krever den nisjeteknologi, spesialmaskinvare eller mye manuell konfigurasjon? | OK | En webapp med filopplasting, database og LLM-API er godt dokumentert. |
| **Kontroll på KI-ens arbeid** – kan gruppen selv avgjøre om koden gjør det riktige? Krever domenet kunnskap gruppen ikke har, f.eks. avanserte beregninger eller fagregler, så er det vanskelig å kvalitetssikre. | Risiko | Koden kan dere kontrollere, men kvaliteten på genererte spørsmål og svar er vanskeligere. Bruk et fast testdokument dere kjenner godt, og vurder svarene mot det. |
| **Testbarhet** – finnes det tydelige regler og forventede resultater som tester kan skrives mot? | Risiko | Quizretting, lagring av feil og gjenopptak av prosjekt kan testes godt. KI-utdata må testes med mock-svar og kontroll av format (for eksempel at quizen har gyldig struktur). |
| **Kjørbar for sensor** – kan appen kjøres lokalt etter README, uten gruppens nøkler, betalte kontoer eller egen infrastruktur? | Stor risiko | Uten en plan for testmodus eller mock-svar kan ikke sensor prøve noen av funksjonene. Dette må inn i PRD og arkitektur. |
| **Avhengigheter og kostnader** – krever løsningen betalte API-er, f.eks. språkmodeller, og finnes det en plan for kostnad, testmodus eller mock-data? | Risiko | Briefen nevner ikke modell, kostnad eller testmodus. Vurder en modell med gratisnivå eller lokal modell, og beskriv hvordan sensor setter inn egen nøkkel. |

**Konklusjon om gjennomførbarhet:**

- **Gjennomførbart med justert omfang.** Se forslagene under.

**Forslag til justering av omfang eller vanskelighetsgrad:**

1. Del v1 i to trinn: trinn 1 er opplasting, Quiz, Mistake Review og Saved Projects. Trinn 2 er Flashcards, Summarize og Ask AI. Flashcards og Summarize er relativt enkle når trinn 1 virker, mens Ask AI krever mest arbeid med forankring i dokumentet.
2. Begrens v1 til PDF med tekst og ren tekst, med en fast maksimal størrelse, og la Saved Projects være lokal lagring uten innlogging. Det fjerner to store risikoer uten å svekke kjerneflyten.

## Hvorfor product brief er viktig for mappen

Product brief er utgangspunktet for PRD, arkitektur, stories og til slutt koden. Del 1 av mappen vurderes blant annet på om sensor kan følge en sporbar vei fra plan til ferdig app. Den vurderes også på om appen gjør det dere har beskrevet, om den er testet, om den er godt designet, og om den kan kjøres etter README. Et uklart, for stort eller for lite brief gjør alt dette vanskeligere senere. Det er mye enklere å rette nå enn sent i semesteret.

## 1. Gjennomgang av briefens deler

| Del av brief | Status | Kommentar |
|---|---|---|
| Executive Summary – er det klart hva appen er, og hvilket problem den løser? | OK | Klart hva appen er og hvorfor den finnes, og den lukkede læringssløyfen med Mistake Review kommer godt fram. |
| The Problem – er problemet konkret, med reelle situasjoner og brukere? | OK | Konkret: det tar tid å lage quiz av førti lysbilder, og samme hull i forståelsen dukker opp igjen fordi ingen holder rede på feilene. |
| The Solution – beskriver løsningen brukeropplevelsen, ikke bare teknologi? | OK | Beskriver hva studenten gjør, ikke teknologien. Legg gjerne til hvordan Mistake Review lager «follow-up practice»: nye spørsmål fra KI eller de samme spørsmålene på nytt? |
| What Makes This Different – er vurderingen ærlig og realistisk? | OK | Svært ærlig og realistisk om konkurrentene. |
| Who This Serves – er primærbrukerne tydelige, og vet vi hva de trenger? | Juster | «University or college student» er en god start. Gjør det mer konkret, for eksempel en student som forbereder seg til eksamen i et bestemt type fag, slik at testmateriale og design kan bygges rundt dem. |
| Success Criteria – kan kriteriene faktisk sjekkes eller testes? | Juster | De seks punktene er funksjonelle og gode som testtilfeller. De to gjennomgående betingelsene (relevans og «uten instruksjon») må gjøres målbare. |
| Scope – er det klart hva som er med i første versjon, og hva som ikke er det? | Juster | Tydelig inn/ut, men seks funksjoner er mye. Prioriter dem, og avklar filtyper og innlogging. |
| Vision – henger visjonen sammen med resten uten å blåse opp omfanget? | OK | Visjonen bygger naturlig videre på Mistake Review og holdes utenfor v1. |

## 2. Utgangspunkt for del 1 av mappen

Punktene følger kriteriene i sensorveiledningen for del 1. Vektene i parentes viser hvor mye hvert kriterium teller i del 1.

| Kriterium i del 1 | Hva briefen bør legge til rette for | Status | Kommentar |
|---|---|---|---|
| **1. Prosess og KI-styring** (30 %) | Brief som er presis nok til at PRD og stories kan bygges direkte på den, slik at krav kan spores fra brief til kode. | OK | De navngitte funksjonene gir god sporbarhet fra brief til stories. Sørg for at commit-meldingene framover beskriver hva som endres (loggen har i dag flere meldinger som «testing another account»). |
| **2. Funksjonalitet og omfang** (20 %) | Realistisk omfang for gruppen og semesteret: en tydelig kjerneflyt som kan bli ferdig og stabil, og nok innhold til å vise reell funksjonalitet. | Juster | Nok funksjonalitet, men risiko for at seks funksjoner blir halvferdige. Prioriter som foreslått over. |
| **3. Kvalitetssikring og testing** (15 %) | Suksesskriterier og funksjoner som er konkrete nok til å bli testtilfeller. | Juster | Quizretting og Mistake Review egner seg godt for tester. Planlegg mock-svar for KI-delen. |
| **4. Design og brukeropplevelse** (10 %) | Tydelige brukere og brukssituasjoner som designet kan bygges rundt, gjerne med de viktigste skjermbildene eller flytene skissert. | OK | «Simple enough to use without instruction» er et godt designmål. Skisser prosjektsiden med de fire handlingene og quizvisningen. Tenk også på venting mens KI genererer. |
| **5. Kodekvalitet og arkitektur** (10 %) | Teknologivalg som er begrunnet og ikke mer komplekse enn appen trenger. | OK | Ingen teknologivalg i briefen, og det er riktig. Samle alle LLM-kall i én modul i arkitekturen, slik at mock-modus blir enkel. |
| **6. README og kjørbarhet** (10 %) | Løsning som andre kan kjøre lokalt uten betalte kontoer, og uten tilgang til gruppens egne tjenester og nøkler. | Endre | Avhengig av LLM-nøkkel. Planlegg `.env.example`, testmodus og et eksempeldokument sensor kan laste opp. |
| **7. Ryddighet i repoet** (5 %) | En plan for hvor hemmeligheter, testdata og dokumentasjon skal ligge. | Juster | Hold API-nøkkelen utenfor repoet med `.gitignore`, og legg testdokumenter i en egen mappe. Unngå løse testfiler i roten, slik som tidligere `test.py`. |

## 3. Neste steg for gruppen

1. Bestem språkmodell, hvordan nøkkelen håndteres og hvordan testmodus med mock-svar skal virke, og skriv det inn i briefen eller PRD-en.
2. Prioriter de seks funksjonene i trinn, og gjør suksesskriteriene om relevans og brukervennlighet målbare.
3. Avklar filtyper, maksimal filstørrelse og om Saved Projects krever innlogging. Gå deretter videre til PRD.

Oppdater product brief i repoet når dere har gjort endringene, slik at historikken viser hvordan planen utviklet seg. Det er en del av prosessen sensor ser etter.
