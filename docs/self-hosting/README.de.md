# Ronde selbst hosten

Ronde läuft auf jedem Rechner mit Docker: die App, eine PostgreSQL-Datenbank und ein einmaliger Container,
der die Datenbankmigrationen jeder Version einspielt. Alles in der Community-Edition ist kostenlos, ohne
Grenze bei Meetings oder Personen. Ein Lizenzschlüssel schaltet die Funktionen von Team oder Enterprise frei.

## Starten

1. Hol dir die Dateien:

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. Fülle `.env` aus: die Adresse, die die Leute öffnen (`RONDE_URL`), und drei Secrets.

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. Starte:

   ```sh
   docker compose up -d
   ```

4. Öffne `RONDE_URL` und lege das erste Konto an: Es wird zum Administratorkonto der Instanz.

## HTTPS

Lass eine Domain auf den Rechner zeigen, setze `RONDE_DOMAIN=ronde.example.com` und
`RONDE_URL=https://ronde.example.com` in `.env` und starte mit dem Profil `https`. Caddy holt und erneuert das
Zertifikat.

```sh
docker compose --profile https up -d
```

Hinter deinem eigenen Reverse Proxy leitest du stattdessen an den Port `RONDE_PORT` weiter (standardmäßig
3000) und behältst die Header `X-Forwarded-*` bei. Server-Sent Events dürfen nicht gepuffert werden
(`proxy_buffering off` bei nginx).

## E-Mail

Anmeldelinks, Einladungen und Erinnerungen brauchen einen SMTP-Server:
`SMTP_URL=smtp://user:password@smtp.example.com:587` und `MAIL_FROM`. Zum Ausprobieren startet das Profil
`mail` Mailpit, das alle E-Mails abfängt:

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

Damit alle ihren Check-in per Antwort auf die Erinnerung ausfüllen können, gib Ronde ein Postfach zum Lesen: `INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX`, dazu `INBOUND_ADDRESS`, wenn der Login nicht die E-Mail-Adresse ist. Antworten gehen dorthin; jede Minute liest Ronde die Antworten auf eine Erinnerung, fügt ihre Zeilen dem Check-in hinzu, bestätigt per E-Mail und verschiebt sie in einen Ordner `Ronde`. Alle anderen Nachrichten bleiben unberührt, das Postfach kann also deine übliche Kontaktadresse sein.

Push-Benachrichtigungen (wenn man bald dran ist, Erinnerungen an den Check-in, die Glocke) brauchen ein Schlüsselpaar für die Instanz: `npx web-push generate-vapid-keys`, dann `WEB_PUSH_PUBLIC_KEY` und `WEB_PUSH_PRIVATE_KEY`. Bewahre sie auf: Die Geräte mit aktivierten Benachrichtigungen hängen davon ab. Ronde muss über HTTPS laufen; auf dem iPhone fügt man es zuerst zum Home-Bildschirm hinzu.

## Anmeldung

Lokale Konten und Magic Links funktionieren sofort. `SIGNUP_POLICY` legt fest, wer ein Konto anlegen darf:
`invite-only` (Standard), `open` oder `domains` mit `SIGNUP_ALLOWED_DOMAINS`. Ein OpenID-Connect-Anbieter
(Keycloak, Authentik, Entra ID, Okta…) wird mit den Variablen `OIDC_*` eingerichtet; Google, GitHub und
Microsoft mit ihren `<PROVIDER>_CLIENT_ID` und `<PROVIDER>_CLIENT_SECRET`. Weiterleitungs-URI:
`<RONDE_URL>/api/auth/callback/<provider>`.

## Transkripte, ohne Ton nach außen zu schicken

Transkripte (Team) nutzen einen Sprache-zu-Text-Dienst mit der API von OpenAI. Um den Ton auf deinen Servern
zu behalten, starte das Profil `whisper` und verweise Ronde darauf:

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

Mit einer Team- oder Enterprise-Lizenz können Arbeitsbereiche Ronde zu Slack hinzufügen:
Check-in-Erinnerungen per Direktnachricht, Check-ins aus einem Slack-Formular, Benachrichtigungen in einem
Kanal und der Befehl `/ronde`. Die Instanz braucht ihre eigene Slack-App, einmal angelegt. Slack muss
`RONDE_URL` per HTTPS erreichen.

1. Hol dir das Manifest der App und ersetze darin jedes `https://ronde.example.com` durch deine `RONDE_URL`:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. Auf [api.slack.com/apps](https://api.slack.com/apps): **Create New App › From a manifest**, wähle deinen
   Slack-Workspace und füge die Datei ein.
3. Kopiere die Schlüssel unter **Basic Information › App Credentials** in `.env` (`SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`) und führe dann `docker compose up -d` aus.
4. In Ronde öffnet ein Inhaber oder Admin jedes Arbeitsbereichs **Einstellungen › Slack › Zu Slack hinzufügen**.

Um die App mehreren Slack-Workspaces hinzuzufügen, aktiviere **Manage Distribution** in den Einstellungen der App.

## Microsoft Teams

Mit einer Team- oder Enterprise-Lizenz können Arbeitsbereiche Ronde zu Microsoft Teams hinzufügen:
Check-in-Erinnerungen per persönlicher Nachricht, Check-ins aus einer Karte ausgefüllt, Benachrichtigungen in
einem Kanal und der Befehl `ronde`. Die Instanz braucht ihre eigene Teams-App, einen Azure Bot, der einmal in
deiner Microsoft-Organisation registriert wird. Microsoft muss `RONDE_URL` per HTTPS erreichen.

1. Im [Azure-Portal](https://portal.azure.com): **Create a resource › Azure Bot**, mit einem Handle (`ronde`),
   dem kostenlosen Tarif **F0**, **Type of App: Single Tenant** und **Create new Microsoft App ID**.
2. Im Bot unter **Settings › Configuration**: Setze den **Messaging endpoint** auf
   `https://ronde.example.com/api/teams/messages` (deine `RONDE_URL`), speichere und kopiere die **Microsoft App
   ID** und die **App Tenant ID**.
3. **Manage Password** auf derselben Seite öffnet die App-Registrierung: **Certificates & secrets › New client
   secret**, dann kopiere seinen **Value** (wird nur einmal angezeigt).
4. Im Bot unter **Settings › Channels**: Füge **Microsoft Teams** hinzu und nimm die Bedingungen an.
5. Trag die drei Werte in `.env` ein (`TEAMS_APP_ID`, `TEAMS_TENANT_ID`, `TEAMS_APP_PASSWORD`) und führe dann
   `docker compose up -d` aus.
6. In Ronde öffnet ein Inhaber oder Admin eines Arbeitsbereichs **Einstellungen › Microsoft Teams** und lädt die
   App herunter. Ein Teams-Admin lädt sie hoch (Teams Admin Center › Teams-Apps › Apps verwalten ›
   Neue App hochladen) und fügt sie einem Team hinzu: Ronde veröffentlicht eine Karte in dessen Kanal, und
   **Mit Ronde verknüpfen** wählt den Arbeitsbereich.

Das Client-Secret läuft nach 6 bis 24 Monaten ab: Lege das nächste vorher an und ersetze `TEAMS_APP_PASSWORD`.
Ein Single-Tenant-Bot bedient die Personen deiner eigenen Microsoft-Organisation; um die App anderen
Organisationen anzubieten, wird sie im Teams Store veröffentlicht.

## Aktualisieren

```sh
docker compose pull && docker compose up -d
```

Der Container `migrate` spielt die Migrationen der neuen Version ein, bevor die App startet. Lege mit
`RONDE_VERSION=1.0.0-beta.3` in `.env` eine Version fest, um selbst zu entscheiden, wann du aktualisierst.

## Backups

Alles liegt im PostgreSQL-Volume:

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## Images

| Image | Was es ist |
|---|---|
| `ghcr.io/joinronde/ronde` | Die App, alle Editionen (kostenpflichtige Funktionen ohne Lizenz aus) |
| `ghcr.io/joinronde/ronde-ce` | Die App ohne den Code der kostenpflichtigen Editionen (nur AGPL) |
| `ghcr.io/joinronde/ronde-migrate` | Die Datenbankmigrationen derselben Version |

Jede geheime Variable akzeptiert auch `<NAME>_FILE` (Docker Secrets). Bildung: Schulen und Hochschulen
bekommen die kostenpflichtigen Tarife gratis, Anfrage unter https://joinronde.com/de/education.
