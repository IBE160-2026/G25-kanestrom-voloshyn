# Gi nytt navn: klikk utenfor avbryter

## 2026-11-20 kl. 15:23 — crikan01

### Oppgave
Cristoffer: når man gir et prosjekt nytt navn (tittelen i toppfeltet eller «Gi nytt navn» i sidepanelet) og klikker et annet sted, blir feltet stående åpent. Et klikk utenfor skal avbryte, slik brukere forventer.

### Plan
- `ProjectName` lukker feltet ved blur, som Esc: det gamle navnet beholdes og ingen forespørsel sendes. Fokus flyttes ikke tilbake til tittelen eller «···», så klikket havner der man klikket.
- En lagring som er i gang avgjør fortsatt resultatet. Emnenavn (`TopicList`) avbrøt allerede ved klikk utenfor.

### Resultat
- `2bbcedd` på `fix/rename-click-away`: `ProjectName.jsx` og `Sidebar.jsx` er endret, og det er 3 nye tester i `ProjectName.test.jsx`. Frontend: 858 tester grønne, lint ren. Docker er bygget på nytt. Ingenting er pushet.

### Åpne punkter
- EXPERIENCE.md L327 og L331 (final) sier bare «Enter saves, Esc cancels». Teksten «a click elsewhere cancels» bør legges til av Cristoffer eller Ihor.

## 2026-11-20 kl. 15:25 — crikan01

### Oppgave
Cristoffer: alt fungerer, push og merge.

### Plan
- Pushe `fix/rename-click-away`, merge den inn i main med `--no-ff` og pushe main.

### Resultat
- Grenen er pushet og merget til main med «fix: cancel a project rename when the student clicks elsewhere». Main er pushet.

### Åpne punkter
- Ingen nye. Teksten i EXPERIENCE.md står i issues.md.
