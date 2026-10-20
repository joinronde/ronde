# Self-hosting Ronde

Ronde runs on any machine with Docker: the app, a PostgreSQL database, and a one-off container that applies
the database migrations of each version. Everything in the Community edition is free, with no limit on
meetings or people. A license key turns on the Team or Enterprise features.

## Start

1. Get the files:

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. Fill in `.env`: set the address people will open (`RONDE_URL`), then generate the three secrets:

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. Start:

   ```sh
   docker compose up -d
   ```

4. Open `RONDE_URL` and create the first account: it becomes the administrator of the instance.

## HTTPS

Point a domain at the machine, set `RONDE_DOMAIN=ronde.example.com` and `RONDE_URL=https://ronde.example.com`
in `.env`, then start with the `https` profile. Caddy obtains and renews the certificate.

```sh
docker compose --profile https up -d
```

If you use your own reverse proxy instead, forward to port `RONDE_PORT` (3000 by default) and keep the
`X-Forwarded-*` headers. Server-Sent Events must not be buffered (`proxy_buffering off` with nginx).

## Email

Sign-in links, invitations and reminders need an SMTP server: `SMTP_URL=smtp://user:password@smtp.example.com:587`
and `MAIL_FROM`. For a trial, the `mail` profile starts Mailpit, which catches every email:

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

To let people fill in their check-in by replying to the reminder, give Ronde a mailbox to read: `INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX`, and `INBOUND_ADDRESS` when the login is not the email address. Replies are sent there; every minute Ronde reads the ones that answer a reminder, adds their lines to the check-in, confirms by email and moves them to a `Ronde` folder. All other messages in the mailbox are left untouched, so it can be your usual contact address.

Push notifications (your turn coming up, check-in reminders, the bell) need a pair of keys for the instance: generate them with `npx web-push generate-vapid-keys`, then set `WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY`. Keep them: the devices that turned on notifications depend on them. Ronde must be served over HTTPS; on an iPhone, people add it to the home screen first.

## Sign-in

Local accounts and magic links work out of the box. `SIGNUP_POLICY` decides who may create an account:
`invite-only` (default), `open`, or `domains` with `SIGNUP_ALLOWED_DOMAINS`. One OpenID Connect provider
(Keycloak, Authentik, Entra ID, Okta…) is set with the `OIDC_*` variables; Google, GitHub and Microsoft with
their `<PROVIDER>_CLIENT_ID` and `<PROVIDER>_CLIENT_SECRET`. Redirect URI: `<RONDE_URL>/api/auth/callback/<provider>`.

## Transcripts without sending sound away

Transcripts (Team) use a speech-to-text service with an OpenAI-compatible API. To keep the audio on your servers,
start the `whisper` profile and point Ronde at it:

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

With a Team or Enterprise license, workspaces can add Ronde to Slack: check-in reminders by direct
message, check-ins filled in from a Slack form, notifications in a channel, and the `/ronde` command. The
instance needs its own Slack app, created once. Slack must be able to reach `RONDE_URL` over HTTPS.

1. Get the app's manifest and replace every `https://ronde.example.com` in it with your `RONDE_URL`:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. At [api.slack.com/apps](https://api.slack.com/apps): **Create New App › From a manifest**, pick your
   Slack workspace and paste the file.
3. Copy the keys from **Basic Information › App Credentials** into `.env` (`SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`), then run `docker compose up -d`.
4. In Ronde, an owner or admin of each workspace opens **Settings › Slack › Add to Slack**.

To add the app to several Slack workspaces, turn on **Manage Distribution** in the app's settings.

## Microsoft Teams

With a Team or Enterprise license, workspaces can add Ronde to Microsoft Teams: check-in reminders by
personal message, check-ins filled in from a card, notifications in a channel, and the `ronde` command. The
instance needs its own Teams app, an Azure Bot registered once in your Microsoft organization. Microsoft must
be able to reach `RONDE_URL` over HTTPS.

1. In the [Azure portal](https://portal.azure.com): **Create a resource › Azure Bot**, with a handle
   (`ronde`), the free **F0** plan, **Type of App: Single Tenant** and **Create new Microsoft App ID**.
2. In the bot, **Settings › Configuration**: set the **Messaging endpoint** to
   `https://ronde.example.com/api/teams/messages` (your `RONDE_URL`), save, and copy the **Microsoft App ID**
   and the **App Tenant ID**.
3. **Manage Password**, on the same page, opens the app registration: **Certificates & secrets › New client
   secret**, then copy its **Value** (shown once).
4. In the bot, **Settings › Channels**: add **Microsoft Teams** and accept its terms.
5. Put the three values in `.env` (`TEAMS_APP_ID`, `TEAMS_TENANT_ID`, `TEAMS_APP_PASSWORD`), then run
   `docker compose up -d`.
6. In Ronde, an owner or admin of a workspace opens **Settings › Microsoft Teams** and downloads the app. A Teams
   administrator uploads it (Teams admin center › Teams apps › Manage apps › Upload new app) and adds it to a
   team: Ronde posts a card in its channel, and **Link to Ronde** picks the workspace.

The client secret expires after 6 to 24 months: create a new one before it expires, and replace `TEAMS_APP_PASSWORD`. A
single-tenant bot serves the people of your own Microsoft organization; to offer the app to other
organizations, it must be published in the Teams Store.

## Upgrade

```sh
docker compose pull && docker compose up -d
```

The `migrate` container applies the migrations of the new version before the app starts. Pin a version with
`RONDE_VERSION=1.0.0-beta.3` in `.env` to choose when to upgrade.

## Backups

Everything lives in the PostgreSQL volume:

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## Images

| Image | What it is |
|---|---|
| `ghcr.io/joinronde/ronde` | The app, every edition (paid features off without a license) |
| `ghcr.io/joinronde/ronde-ce` | The app without the code of the paid editions (AGPL only) |
| `ghcr.io/joinronde/ronde-migrate` | The database migrations of the same version |

Every secret variable also accepts `<NAME>_FILE` (Docker secrets). Education: schools and universities get the
paid plans for free; ask at https://joinronde.com/education.
