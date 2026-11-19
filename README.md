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

Etter at kontoen er opprettet, sender appen en e-post med en bekreftelseslenke som gjelder i 24 timer. Lokalt havner den i Mailpit på <http://localhost:54324>; åpne lenken der for å bekrefte e-postadressen. Du kan bruke appen uten å bekrefte; bekreftelsen trengs bare for å koble til en Google-konto.

Har du glemt passordet, velg «Forgot password?» («Glemt passordet?» på norsk) på innloggingssiden. E-posten med lenken for å velge nytt passord havner også i Mailpit. Lenken gjelder i 1 time og bare én gang, og en ny lenke erstatter de eldre. Etter at du har lagret det nye passordet, blir du logget ut på alle andre enheter. En konto som bare logger inn med Google, får den samme meldingen om at lenken er sendt, men ingen e-post.

`LLM_MODE` kan stå tom: i utvikling uten nøkkel blir den `mock`. SMTP-verdiene i `.env` kan stå tomme lokalt; standardverdiene sender til Mailpit. Google-innlogging er skjult til `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true` og begge Google-verdiene er satt.

### Google-innlogging (valgfritt)

Uten Google-nøkler vises ingen «Sign in with Google»-knapp, og alt annet virker som før. Sensor trenger ikke dette. Slik slår du det på lokalt:

1. I [Google Cloud Console](https://console.cloud.google.com/): opprett eller velg et prosjekt, sett opp «OAuth consent screen» (type «External», legg deg selv til som testbruker), og opprett så en «OAuth client ID» av typen «Web application».
2. Legg til `http://127.0.0.1:54321/auth/v1/callback` under «Authorized redirect URIs». Det er den lokale Supabase-adressen Google sender tilbake til; Supabase sender deretter videre til appens `/auth/callback`.
3. Sett verdiene i den lokale `.env` (aldri commit dem):
   ```sh
   SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<klient-ID fra Google>
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<klienthemmelighet fra Google>
   ```
4. Start Supabase på nytt (`npx supabase stop && npx supabase start`) og appen (`docker compose up --build`), slik at begge leser `.env`.

Knappen vises da på innloggingssiden og på «Create account». Start Google-innloggingen fra <http://localhost:8000> eller <http://127.0.0.1:8000>, ikke fra adressen i lokalnettet; bare disse adressene står som tillatte returadresser i `supabase/config.toml`. Har du allerede en konto med samme e-postadresse og har bekreftet den, logger Google inn på den kontoen, og passordet virker fortsatt. Er e-postadressen ikke bekreftet, tar Google-innloggingen over kontoen: det gamle passordet slutter å virke, alle andre økter blir logget ut, og du ser meldingen «Your account now signs in with Google.» én gang. En Google-identitet med en annen e-postadresse enn kontoens blir fjernet fra en ubekreftet konto og tar den aldri over.

I et Supabase Cloud-prosjekt må innstillingen «Require current password when updating» stå av, slik `secure_password_change = false` gjør lokalt. Ellers kan ikke overtakelsen sette det nye tilfeldige passordet, og innloggingen svarer med en feil. «Manual linking» må stå på (som `enable_manual_linking = true` lokalt), ellers kan ikke appen fjerne en Google-identitet med feil e-postadresse.

### Mobil på lokalnettet (opplasting fra telefon)

QR-koden for opplasting fra telefon (FR-21) peker på `APP_PUBLIC_URL`. Standardverdien er `http://localhost:8000`, og på telefonen betyr «localhost» telefonen selv. For å demonstrere med en ekte telefon må appen derfor nås på datamaskinens adresse i lokalnettet:

1. Koble datamaskinen og telefonen til samme Wi-Fi. Gjestenett og skolenett som skiller enhetene fra hverandre virker ikke; bruk da en mobil hotspot.
2. Finn datamaskinens IPv4-adresse i Wi-Fi-nettet: `ipconfig` på Windows (linjen «IPv4 Address» under Wi-Fi-adapteren, for eksempel `192.168.10.109`), `ipconfig getifaddr en0` på macOS. Ignorer adresser fra Docker, WSL og VPN (ofte `172.x` eller `100.x`).
3. Sett adressen i `.env`:
   ```sh
   APP_PUBLIC_URL=http://192.168.10.109:8000
   SUPABASE_PUBLIC_URL=http://192.168.10.109:54321
   ```
   `APP_PUBLIC_URL` er det QR-koden og e-postlenkene peker på. `SUPABASE_PUBLIC_URL` trengs bare hvis noen skal logge inn fra telefonen eller en annen maskin; selve opplastingssiden på telefonen bruker ikke innlogging.
4. Start appen på nytt slik at `.env` leses: `docker compose up --build`. Datamaskinen kan fortsatt bruke <http://localhost:8000>.
5. Sjekk fra telefonens nettleser at <http://192.168.10.109:8000> (med din adresse) viser innloggingssiden. Gjør den ikke det:
   - Windows: Wi-Fi-nettet må være satt som **Privat** nettverk (Innstillinger → Nettverk og Internett → Wi-Fi → nettverket). Docker Desktop legger selv inn brannmurregler for portene sine.
   - Adressen kan ha endret seg etter omstart av ruteren; sjekk `ipconfig` på nytt og oppdater `.env`.

Bare for Google-innlogging fra en annen enhet: legg i tillegg `http://<adresse>:8000/auth/callback` til `additional_redirect_urls` i `supabase/config.toml`, og start Supabase på nytt (`npx supabase stop && npx supabase start`). Ikke commit den lokale adressen.

I utviklingsmodus (uvicorn og Vite hver for seg) lytter begge bare på maskinen selv. Start dem med `uv run uvicorn app.main:app --reload --host 0.0.0.0` og `npm run dev -- --host`, og bruk Vite-porten i `APP_PUBLIC_URL` (`http://<adresse>:5173`).

Når demoen er ferdig, tøm `APP_PUBLIC_URL` og `SUPABASE_PUBLIC_URL` i `.env` igjen, ellers peker e-postlenkene på en adresse som kan være borte neste gang.

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
