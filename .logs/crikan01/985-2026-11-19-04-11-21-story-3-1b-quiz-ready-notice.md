# Story 3.1b: varsel om at quizen er klar

## 2026-11-19 kl. 04:11 — crikan01

### Oppgave
Fullføre story 3.1 med delen som ble splittet ut: et varsel i chatten når en quiz blir ferdig mens studenten er borte fra oppsettsiden.

### Plan
- `bmad-build`: spec [spec-3-1b-quiz-ready-notice-in-the-chat.md](../../_bmad-output/implementation-artifacts/spec-3-1b-quiz-ready-notice-in-the-chat.md), godkjent av Cristoffer sammen med teksten for {topic}.
- Implementasjon i underagent, tre reviewere, triage og retting, nettlesersjekk, merge.

### Resultat
- **Backend:** jobblista gir `topic_labels` for quiz-jobber (låst ved bestilling). Feil format tåles.
- **Frontend:** Prosjekthjem leser jobbene og poller mens en quiz lages. «Your quiz on {topic} is ready · Open» vises for hver ferdige, usette quiz. «Open» skjuler varselet og åpner quizen med en gang. × merker den som sett, og fokus flyttes videre.
- **Tekst:** {topic}-teksten («all topics», «A and B», «A and n more») er godkjent av Cristoffer og ført inn i EXPERIENCE.md.
- **Review:** 12 funn, 9 rettet, 3 avvist.
- **Tester:** backend 560 passed, frontend 512 passed, lint rent.
- **Merge:** commits 6686a2d og 9418d0f, merge 9330d59 til main, pushet. Story 3.1 er nå ferdig.

### Åpne punkter
- Ingen nye.
