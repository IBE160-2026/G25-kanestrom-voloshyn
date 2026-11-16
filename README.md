# G25 — 🔍🥸Sherlock and Watson🕵🏻👣👣

Gruppeprosjekt i **IBE160 Programmering med KI** ved Høgskolen i Molde, høsten 2026 (15 studiepoeng).

Repoet inneholder gruppens applikasjon og dokumentasjon av utvikling, testing og kvalitetssikring med KI.

## Medlemmer

- Cristoffer Mathias Kanestrøm
- Ihor Voloshyn

## Kjør lokalt

Appen kjører helt lokalt i mock-modus, uten API-nøkkel og uten betalte kall.

### Forutsetninger

- Docker Desktop (kjørende)
- Node.js ≥ 22.22.2 (for Supabase CLI via `npx`)
- [uv](https://docs.astral.sh/uv/) (bare for utvikling og tester; Python 3.14 hentes av uv)

### Starte appen (sensor)

1. Kopier miljøfila: `cp .env.example .env`
2. Installer den låste Supabase CLI-en: `npm install`
3. Start lokal Supabase: `npx supabase start`
4. Kopier de to nøklene fra utskriften inn i `.env` (`npx supabase status` viser dem igjen): `SUPABASE_PUBLISHABLE_KEY` og `SUPABASE_SECRET_KEY`. URL-ene kan stå tomme; standardverdiene peker på lokal Supabase, og `docker-compose.yml` setter containerens egne adresser (`host.docker.internal`).
5. Kjør migreringene: `npx supabase db reset`
6. Start appen: `docker compose up --build`
7. Åpne <http://localhost:8000>

Har du allerede kjørt Supabase fra en eldre versjon av repoet, start den på nytt etter `git pull` (`npx supabase stop && npx supabase start`), slik at Mailpit tar imot e-post på SMTP-port 54325, og kjør `npx supabase db reset` for nye migreringer.

Opprett en konto på <http://localhost:8000/signup> (fornavn, e-post og et passord på minst 8 tegn); du havner da på Prosjekter-siden. Lenken «Opprett konto» på startsiden går dit.

Etter at kontoen er opprettet, sender appen en e-post med en bekreftelseslenke som virker i 24 timer. Lokalt havner den i Mailpit på <http://localhost:54324>; åpne lenken der for å bekrefte e-postadressen. Du kan bruke appen uten å bekrefte; bekreftelsen trengs bare for å koble til en Google-konto.

Har du glemt passordet, velg «Forgot password?» («Glemt passordet?» på norsk) på innloggingssiden. E-posten med lenken for å velge nytt passord havner også i Mailpit. Lenken virker i 1 time og bare én gang, og en ny lenke erstatter de eldre. Etter at du har lagret det nye passordet, blir du logget ut på alle andre enheter. En konto som bare logger inn med Google, får den samme meldingen om at lenken er sendt, men ingen e-post.

`LLM_MODE` kan stå tom: i utvikling uten nøkkel blir den `mock`. SMTP-verdiene i `.env` kan stå tomme lokalt; standardverdiene sender til Mailpit. Google-innlogging er skjult til `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true` og begge Google-verdiene er satt.

### Utvikling

Backend og frontend kjøres hver for seg; Vite videresender `/api` til uvicorn. Samme `.env` brukes som for Docker.

```sh
# Backend (http://localhost:8000), én worker
cd backend
uv run uvicorn app.main:app --reload

# Frontend (http://localhost:5173), i en annen terminal
cd frontend
npm install
npm run dev
```

### Tester

Med lokal Supabase kjørende:

```sh
cd backend
uv run pytest
```

Testene kjører alltid med `LLM_MODE=mock` og trenger ingen nøkkel.

Frontend-testene (Vitest i jsdom) trenger verken backend, Supabase eller nettverk:

```sh
cd frontend
npm test
```
