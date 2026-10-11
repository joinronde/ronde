# Ospitare Ronde in proprio

Ronde gira su qualsiasi macchina con Docker: l'app, un database PostgreSQL e un container occasionale che
applica le migrazioni del database di ogni versione. Tutto ciò che offre l'edizione Community è gratuito,
senza limiti di riunioni o persone. Una chiave di licenza attiva le funzioni di Team o Enterprise.

## Avvio

1. Scarica i file di una release:

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. Compila `.env`: l'indirizzo che le persone apriranno (`RONDE_URL`) e tre segreti.

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. Avvia:

   ```sh
   docker compose up -d
   ```

4. Apri `RONDE_URL` e crea il primo account: diventa l'amministratore dell'istanza.

## HTTPS

Fai puntare un dominio alla macchina, imposta `RONDE_DOMAIN=ronde.example.com` e
`RONDE_URL=https://ronde.example.com` in `.env`, poi avvia con il profilo `https`. Caddy ottiene e rinnova il
certificato.

```sh
docker compose --profile https up -d
```

Dietro un tuo reverse proxy, inoltra invece alla porta `RONDE_PORT` (3000 per impostazione predefinita) e
conserva le intestazioni `X-Forwarded-*`. I Server-Sent Events non devono essere bufferizzati
(`proxy_buffering off` con nginx).

## Email

Link di accesso, inviti e promemoria richiedono un server SMTP:
`SMTP_URL=smtp://user:password@smtp.example.com:587` e `MAIL_FROM`. Per una prova, il profilo `mail` avvia
Mailpit, che intercetta tutte le email:

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

Per permettere a tutti di compilare la scheda rispondendo al promemoria, dai a Ronde una casella da leggere: `INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX`, e `INBOUND_ADDRESS` quando l'utente non è l'indirizzo email. Le risposte arrivano lì; ogni minuto Ronde legge quelle che rispondono a un promemoria, aggiunge le loro righe alla scheda, conferma via email e le sposta in una cartella `Ronde`. Gli altri messaggi della casella restano come sono, quindi può essere il tuo indirizzo di contatto abituale.

Le notifiche push (il tuo turno che si avvicina, i promemoria della scheda, la campanella) richiedono una coppia di chiavi per l'istanza: `npx web-push generate-vapid-keys`, poi `WEB_PUSH_PUBLIC_KEY` e `WEB_PUSH_PRIVATE_KEY`. Conservale: i dispositivi che hanno attivato le notifiche ne dipendono. Ronde deve essere servito in HTTPS; su iPhone, prima lo si aggiunge alla schermata Home.

## Accesso

Gli account locali e i magic link funzionano subito. `SIGNUP_POLICY` stabilisce chi può creare un account:
`invite-only` (predefinito), `open`, oppure `domains` con `SIGNUP_ALLOWED_DOMAINS`. Un provider OpenID Connect
(Keycloak, Authentik, Entra ID, Okta…) si configura con le variabili `OIDC_*`; Google, GitHub e Microsoft con
i rispettivi `<PROVIDER>_CLIENT_ID` e `<PROVIDER>_CLIENT_SECRET`. URI di reindirizzamento:
`<RONDE_URL>/api/auth/callback/<provider>`.

## Trascrizioni senza inviare l'audio altrove

Le trascrizioni (Team) usano un servizio di trascrizione compatibile con l'API di OpenAI. Per tenere l'audio
sui tuoi server, avvia il profilo `whisper` e indicalo a Ronde:

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

Con una licenza Team o Enterprise, gli spazi di lavoro possono aggiungere Ronde a Slack: promemoria della
scheda in messaggio diretto, schede compilate da un modulo Slack, notifiche in un canale e il comando
`/ronde`. L'istanza ha bisogno della propria app Slack, creata una sola volta. Slack deve poter
raggiungere `RONDE_URL` in HTTPS.

1. Scarica il manifest dell'app e sostituisci ogni `https://ronde.example.com` con il tuo `RONDE_URL`:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. Su [api.slack.com/apps](https://api.slack.com/apps): **Create New App › From a manifest**, scegli il tuo
   spazio Slack e incolla il file.
3. Copia le chiavi di **Basic Information › App Credentials** in `.env` (`SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`), poi esegui `docker compose up -d`.
4. In Ronde, un proprietario o amministratore di ogni spazio apre **Impostazioni › Slack › Aggiungi a Slack**.

Per aggiungere l'app a più spazi Slack, attiva **Manage Distribution** nelle impostazioni dell'app.

## Microsoft Teams

Con una licenza Team o Enterprise, gli spazi di lavoro possono aggiungere Ronde a Microsoft Teams: promemoria
della scheda con messaggio personale, schede compilate da una card, notifiche in un canale e il comando
`ronde`. L'istanza ha bisogno della propria app Teams, un Azure Bot registrato una volta nella tua
organizzazione Microsoft. Microsoft deve raggiungere `RONDE_URL` in HTTPS.

1. Nel [portale di Azure](https://portal.azure.com): **Create a resource › Azure Bot**, con un identificativo
   (`ronde`), il piano gratuito **F0**, **Type of App: Single Tenant** e **Create new Microsoft App ID**.
2. Nel bot, **Settings › Configuration**: imposta il **Messaging endpoint** su
   `https://ronde.example.com/api/teams/messages` (il tuo `RONDE_URL`), salva e copia il **Microsoft App ID** e
   l'**App Tenant ID**.
3. **Manage Password**, nella stessa pagina, apre la registrazione dell'app: **Certificates & secrets › New
   client secret**, poi copia il suo **Value** (mostrato una sola volta).
4. Nel bot, **Settings › Channels**: aggiungi **Microsoft Teams** e accetta le condizioni.
5. Inserisci i tre valori in `.env` (`TEAMS_APP_ID`, `TEAMS_TENANT_ID`, `TEAMS_APP_PASSWORD`), poi esegui
   `docker compose up -d`.
6. In Ronde, un proprietario o un amministratore di uno spazio apre **Impostazioni › Microsoft Teams** e scarica
   l'app. Un amministratore di Teams la carica (Interfaccia di amministrazione di Teams › App di Teams ›
   Gestisci app › Carica nuova app) e la aggiunge a un team: Ronde pubblica una card nel suo canale, e
   **Collega a Ronde** sceglie lo spazio.

Il segreto client scade dopo 6-24 mesi: crea il successivo prima e sostituisci `TEAMS_APP_PASSWORD`. Un bot
single-tenant serve le persone della tua organizzazione Microsoft; per offrire l'app ad altre organizzazioni,
viene pubblicata nel Teams Store.

## Aggiornare

```sh
docker compose pull && docker compose up -d
```

Il container `migrate` applica le migrazioni della nuova versione prima che l'app parta. Fissa una versione
con `RONDE_VERSION=1.0.0-beta.3` in `.env` per scegliere quando aggiornare.

## Backup

Tutto sta nel volume PostgreSQL:

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## Immagini

| Immagine | Che cos'è |
|---|---|
| `ghcr.io/joinronde/ronde` | L'app, tutte le edizioni (funzioni a pagamento disattivate senza licenza) |
| `ghcr.io/joinronde/ronde-ce` | L'app senza il codice delle edizioni a pagamento (solo AGPL) |
| `ghcr.io/joinronde/ronde-migrate` | Le migrazioni del database della stessa versione |

Ogni variabile segreta accetta anche `<NAME>_FILE` (Docker secrets). Istruzione: scuole e università ricevono
gratuitamente i piani a pagamento, la richiesta si fa su https://joinronde.com/it/education.
