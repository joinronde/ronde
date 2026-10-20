# Alojar Ronde en tu propio servidor

Ronde funciona en cualquier máquina con Docker: la aplicación, una base de datos PostgreSQL y un contenedor
puntual que aplica las migraciones de la base de datos de cada versión. Todo lo que incluye la edición
Community es gratis, sin límite de reuniones ni de personas. Una clave de licencia activa las funciones de
Team o Enterprise.

## Empezar

1. Descarga los archivos:

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. Rellena `.env`: indica la dirección que abrirán las personas (`RONDE_URL`) y luego genera los tres secretos:

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. Arranca:

   ```sh
   docker compose up -d
   ```

4. Abre `RONDE_URL` y crea la primera cuenta: pasa a ser la administradora de la instancia.

## HTTPS

Apunta un dominio a la máquina, define `RONDE_DOMAIN=ronde.example.com` y
`RONDE_URL=https://ronde.example.com` en `.env`, y arranca con el perfil `https`. Caddy obtiene y renueva el
certificado.

```sh
docker compose --profile https up -d
```

Si usas tu propio proxy inverso, redirige al puerto `RONDE_PORT` (3000 por defecto) y conserva las cabeceras
`X-Forwarded-*`. Los Server-Sent Events no deben almacenarse en búfer (`proxy_buffering off` con nginx).

## Correo

Los enlaces de inicio de sesión, las invitaciones y los recordatorios necesitan un servidor SMTP:
`SMTP_URL=smtp://user:password@smtp.example.com:587` y `MAIL_FROM`. Para una prueba, el perfil `mail` arranca
Mailpit, que captura todos los correos:

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

Para que cada persona pueda rellenar su ficha respondiendo al recordatorio, da a Ronde un buzón que leer: `INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX`, y `INBOUND_ADDRESS` cuando el usuario no sea la dirección de correo. Las respuestas llegan ahí; cada minuto Ronde lee las que responden a un recordatorio, añade sus líneas a la ficha, lo confirma por correo y las mueve a una carpeta `Ronde`. Los demás mensajes del buzón no se tocan, así que puede ser tu dirección de contacto habitual.

Las notificaciones push (tu turno que se acerca, los recordatorios de ficha, la campana) necesitan un par de claves para la instancia: genéralas con `npx web-push generate-vapid-keys` y define `WEB_PUSH_PUBLIC_KEY` y `WEB_PUSH_PRIVATE_KEY`. Consérvalas: los dispositivos que activaron las notificaciones dependen de ellas. Ronde debe servirse por HTTPS; en iPhone, cada persona tiene que añadirlo antes a la pantalla de inicio.

## Inicio de sesión

Las cuentas locales y los enlaces mágicos funcionan desde el principio. `SIGNUP_POLICY` decide quién puede
crear una cuenta: `invite-only` (por defecto), `open`, o `domains` con `SIGNUP_ALLOWED_DOMAINS`. Un proveedor
OpenID Connect (Keycloak, Authentik, Entra ID, Okta…) se configura con las variables `OIDC_*`; Google, GitHub
y Microsoft con sus `<PROVIDER>_CLIENT_ID` y `<PROVIDER>_CLIENT_SECRET`. URI de redirección:
`<RONDE_URL>/api/auth/callback/<provider>`.

## Transcripciones sin enviar el audio fuera

Las transcripciones (Team) usan un servicio de voz a texto compatible con la API de OpenAI. Para mantener el
audio en tus servidores, arranca el perfil `whisper` e indícaselo a Ronde:

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

Con una licencia Team o Enterprise, los espacios de trabajo pueden añadir Ronde a Slack: recordatorios de
ficha por mensaje directo, fichas rellenadas desde un formulario de Slack, notificaciones en un canal y el
comando `/ronde`. La instancia necesita su propia app de Slack, creada una sola vez. Slack debe poder
acceder a `RONDE_URL` por HTTPS.

1. Descarga el manifiesto de la app y sustituye en él cada `https://ronde.example.com` por tu `RONDE_URL`:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. En [api.slack.com/apps](https://api.slack.com/apps): **Create New App › From a manifest**, elige tu
   espacio de Slack y pega el archivo.
3. Copia las claves de **Basic Information › App Credentials** en `.env` (`SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`) y ejecuta `docker compose up -d`.
4. En Ronde, un propietario o administrador de cada espacio abre **Ajustes › Slack › Añadir a Slack**.

Para añadir la app a varios espacios de Slack, activa **Manage Distribution** en los ajustes de la app.

## Microsoft Teams

Con una licencia Team o Enterprise, los espacios de trabajo pueden añadir Ronde a Microsoft Teams: recordatorios
de ficha por mensaje personal, fichas rellenadas desde una tarjeta, notificaciones en un canal y el comando
`ronde`. La instancia necesita su propia app de Teams, un Azure Bot registrado una vez en tu organización de
Microsoft. Microsoft debe poder acceder a `RONDE_URL` por HTTPS.

1. En el [portal de Azure](https://portal.azure.com): **Create a resource › Azure Bot**, con un identificador
   (`ronde`), el plan gratuito **F0**, **Type of App: Single Tenant** y **Create new Microsoft App ID**.
2. En el bot, **Settings › Configuration**: pon como **Messaging endpoint**
   `https://ronde.example.com/api/teams/messages` (tu `RONDE_URL`), guarda y copia el **Microsoft App ID** y el
   **App Tenant ID**.
3. **Manage Password**, en la misma página, abre el registro de la aplicación: **Certificates & secrets › New
   client secret**, y copia su **Value** (se muestra una sola vez).
4. En el bot, **Settings › Channels**: añade **Microsoft Teams** y acepta sus condiciones.
5. Pon los tres valores en `.env` (`TEAMS_APP_ID`, `TEAMS_TENANT_ID`, `TEAMS_APP_PASSWORD`) y ejecuta
   `docker compose up -d`.
6. En Ronde, una persona propietaria o administradora de un espacio abre **Ajustes › Microsoft Teams** y
   descarga la app. Un administrador de Teams la carga (Centro de administración de Teams › Aplicaciones de
   Teams › Administrar aplicaciones › Cargar nueva aplicación) y la añade a un equipo: Ronde publica una tarjeta
   en su canal, y **Vincular a Ronde** elige el espacio.

El secreto de cliente caduca al cabo de 6 a 24 meses: crea uno nuevo antes de que caduque y sustituye `TEAMS_APP_PASSWORD`. Un
bot single-tenant sirve a las personas de tu propia organización de Microsoft; para ofrecer la app a otras
organizaciones, hay que publicarla en la Teams Store.

## Actualizar

```sh
docker compose pull && docker compose up -d
```

El contenedor `migrate` aplica las migraciones de la nueva versión antes de que arranque la aplicación. Fija
una versión con `RONDE_VERSION=1.0.0-beta.3` en `.env` para elegir cuándo actualizar.

## Copias de seguridad

Todo está en el volumen de PostgreSQL:

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## Imágenes

| Imagen | Qué es |
|---|---|
| `ghcr.io/joinronde/ronde` | La aplicación, todas las ediciones (funciones de pago desactivadas sin licencia) |
| `ghcr.io/joinronde/ronde-ce` | La aplicación sin el código de las ediciones de pago (solo AGPL) |
| `ghcr.io/joinronde/ronde-migrate` | Las migraciones de la base de datos de la misma versión |

Cada variable secreta acepta también `<NAME>_FILE` (secretos de Docker). Educación: los centros educativos y
las universidades obtienen gratis los planes de pago; solicítalo en https://joinronde.com/es/education.
