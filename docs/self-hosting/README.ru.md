# Ronde на своём сервере

Ronde работает на любой машине с Docker: приложение, база данных PostgreSQL и разовый контейнер, который
применяет миграции базы данных для каждой версии. Всё, что входит в редакцию Community, бесплатно, без
ограничений на число встреч и людей. Лицензионный ключ включает функции Team или Enterprise.

## Запуск

1. Скачайте файлы релиза:

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. Заполните `.env`: адрес, который будут открывать люди (`RONDE_URL`), и три секрета.

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. Запустите:

   ```sh
   docker compose up -d
   ```

4. Откройте `RONDE_URL` и создайте первый аккаунт: он станет администратором экземпляра.

## HTTPS

Направьте домен на машину, укажите `RONDE_DOMAIN=ronde.example.com` и `RONDE_URL=https://ronde.example.com`
в `.env`, затем запустите с профилем `https`. Caddy получит и будет продлевать сертификат.

```sh
docker compose --profile https up -d
```

Если у вас свой обратный прокси, перенаправляйте на порт `RONDE_PORT` (по умолчанию 3000) и сохраняйте
заголовки `X-Forwarded-*`. Server-Sent Events нельзя буферизовать (`proxy_buffering off` в nginx).

## Почта

Ссылкам для входа, приглашениям и напоминаниям нужен SMTP-сервер:
`SMTP_URL=smtp://user:password@smtp.example.com:587` и `MAIL_FROM`. Для пробы профиль `mail` запускает
Mailpit, который перехватывает все письма:

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

Чтобы участники могли заполнять карточку, отвечая на напоминание, дайте Ronde почтовый ящик для чтения: `INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX` и `INBOUND_ADDRESS`, если логин не совпадает с адресом. Ответы приходят туда; каждую минуту Ronde читает ответы на напоминания, добавляет их строки в карточку, подтверждает письмом и перекладывает их в папку `Ronde`. Остальные письма в ящике не трогаются, так что это может быть ваш обычный контактный адрес.

Push-уведомлениям (приближение вашей очереди, напоминания о карточке, колокольчик) нужна пара ключей для экземпляра: `npx web-push generate-vapid-keys`, затем `WEB_PUSH_PUBLIC_KEY` и `WEB_PUSH_PRIVATE_KEY`. Сохраните их: от них зависят устройства, где включены уведомления. Ronde должен работать по HTTPS; на iPhone его сначала добавляют на экран «Домой».

## Вход

Локальные аккаунты и магические ссылки работают сразу. `SIGNUP_POLICY` определяет, кто может создать
аккаунт: `invite-only` (по умолчанию), `open` или `domains` вместе с `SIGNUP_ALLOWED_DOMAINS`. Один
провайдер OpenID Connect (Keycloak, Authentik, Entra ID, Okta…) настраивается переменными `OIDC_*`; Google,
GitHub и Microsoft — их `<PROVIDER>_CLIENT_ID` и `<PROVIDER>_CLIENT_SECRET`. URI перенаправления:
`<RONDE_URL>/api/auth/callback/<provider>`.

## Расшифровка без отправки звука наружу

Расшифровка (Team) использует сервис распознавания речи с API OpenAI. Чтобы звук оставался на ваших
серверах, запустите профиль `whisper` и укажите его Ronde:

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

С лицензией Team или Enterprise рабочие пространства могут добавить Ronde в Slack: напоминания о карточке
в личных сообщениях, карточки, заполняемые в форме Slack, уведомления в канале и команда `/ronde`.
Экземпляру нужно собственное приложение Slack, создаваемое один раз. Slack должен открывать `RONDE_URL`
по HTTPS.

1. Скачайте манифест приложения и замените в нём каждый `https://ronde.example.com` на ваш `RONDE_URL`:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. На [api.slack.com/apps](https://api.slack.com/apps): **Create New App › From a manifest**, выберите
   свой Slack и вставьте файл.
3. Скопируйте ключи из **Basic Information › App Credentials** в `.env` (`SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`) и выполните `docker compose up -d`.
4. В Ronde владелец или администратор каждого пространства открывает **Настройки › Slack › Добавить в Slack**.

Чтобы добавить приложение в несколько Slack, включите **Manage Distribution** в настройках приложения.

## Microsoft Teams

С лицензией Team или Enterprise рабочие пространства могут добавить Ronde в Microsoft Teams: напоминания о
карточке личным сообщением, карточки, заполненные из Adaptive Card, уведомления в канале и команда `ronde`.
Экземпляру нужно собственное приложение Teams — Azure Bot, один раз зарегистрированный в вашей организации
Microsoft. Microsoft должен достигать `RONDE_URL` по HTTPS.

1. В [портале Azure](https://portal.azure.com): **Create a resource › Azure Bot**, с идентификатором (`ronde`),
   бесплатным тарифом **F0**, **Type of App: Single Tenant** и **Create new Microsoft App ID**.
2. В боте, **Settings › Configuration**: укажите **Messaging endpoint**
   `https://ronde.example.com/api/teams/messages` (ваш `RONDE_URL`), сохраните и скопируйте **Microsoft App ID**
   и **App Tenant ID**.
3. **Manage Password** на той же странице открывает регистрацию приложения: **Certificates & secrets › New
   client secret**, затем скопируйте его **Value** (показывается один раз).
4. В боте, **Settings › Channels**: добавьте **Microsoft Teams** и примите условия.
5. Впишите три значения в `.env` (`TEAMS_APP_ID`, `TEAMS_TENANT_ID`, `TEAMS_APP_PASSWORD`) и выполните
   `docker compose up -d`.
6. В Ronde владелец или администратор пространства открывает **Настройки › Microsoft Teams** и скачивает
   приложение. Администратор Teams загружает его (Центр администрирования Teams › Приложения Teams ›
   Управление приложениями › Отправить новое приложение) и добавляет в команду: Ronde публикует карточку в её
   канале, а **Связать с Ronde** выбирает пространство.

Секрет клиента истекает через 6–24 месяца: создайте следующий заранее и замените `TEAMS_APP_PASSWORD`.
Single-tenant бот обслуживает людей вашей организации Microsoft; чтобы предложить приложение другим
организациям, его публикуют в Teams Store.

## Обновление

```sh
docker compose pull && docker compose up -d
```

Контейнер `migrate` применяет миграции новой версии до запуска приложения. Зафиксируйте версию через
`RONDE_VERSION=1.0.0-beta.3` в `.env`, чтобы самим выбирать момент обновления.

## Резервные копии

Всё хранится в томе PostgreSQL:

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## Образы

| Образ | Что это |
|---|---|
| `ghcr.io/joinronde/ronde` | Приложение, все редакции (платные функции выключены без лицензии) |
| `ghcr.io/joinronde/ronde-ce` | Приложение без кода платных редакций (только AGPL) |
| `ghcr.io/joinronde/ronde-migrate` | Миграции базы данных той же версии |

Каждая секретная переменная принимает и форму `<NAME>_FILE` (секреты Docker). Образование: школы и
университеты получают платные тарифы бесплатно, запрос — на https://joinronde.com/ru/education.
