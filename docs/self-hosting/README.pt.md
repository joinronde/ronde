# Hospedar o Ronde por conta própria

O Ronde roda em qualquer máquina com Docker: o app, um banco de dados PostgreSQL e um contêiner pontual que
aplica as migrações do banco de dados de cada versão. Tudo o que a edição Community oferece é gratuito, sem
limite de reuniões ou de pessoas. Uma chave de licença ativa os recursos do Team ou do Enterprise.

## Começar

1. Baixe os arquivos:

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. Preencha o `.env`: defina o endereço que as pessoas vão abrir (`RONDE_URL`) e depois gere os três segredos:

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. Inicie:

   ```sh
   docker compose up -d
   ```

4. Abra `RONDE_URL` e crie a primeira conta: ela se torna a administradora da instância.

## HTTPS

Aponte um domínio para a máquina, defina `RONDE_DOMAIN=ronde.example.com` e
`RONDE_URL=https://ronde.example.com` no `.env` e inicie com o perfil `https`. O Caddy obtém e renova o
certificado.

```sh
docker compose --profile https up -d
```

Se usar o seu próprio proxy reverso, encaminhe para a porta `RONDE_PORT` (3000 por padrão) e mantenha os
cabeçalhos `X-Forwarded-*`. Os Server-Sent Events não devem passar por buffer (`proxy_buffering off` no
nginx).

## E-mail

Os links de login, os convites e os lembretes precisam de um servidor SMTP:
`SMTP_URL=smtp://user:password@smtp.example.com:587` e `MAIL_FROM`. Para um teste, o perfil `mail` inicia o
Mailpit, que captura todos os e-mails:

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

Para que cada pessoa possa preencher a ficha respondendo ao lembrete, dê ao Ronde uma caixa de correio para ler: `INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX`, e `INBOUND_ADDRESS` quando o login não for o endereço de e-mail. As respostas vão para lá; a cada minuto o Ronde lê as que respondem a um lembrete, acrescenta suas linhas à ficha, confirma por e-mail e as move para uma pasta `Ronde`. As outras mensagens da caixa ficam como estão, então pode ser o seu endereço de contato habitual.

As notificações push (sua vez se aproximando, os lembretes de ficha, o sino) precisam de um par de chaves para a instância: gere-as com `npx web-push generate-vapid-keys` e depois defina `WEB_PUSH_PUBLIC_KEY` e `WEB_PUSH_PRIVATE_KEY`. Guarde-as: os dispositivos que ativaram as notificações dependem delas. O Ronde precisa ser servido por HTTPS; no iPhone, as pessoas precisam primeiro adicioná-lo à Tela de Início.

## Login

Contas locais e links mágicos funcionam de imediato. `SIGNUP_POLICY` define quem pode criar uma conta:
`invite-only` (padrão), `open`, ou `domains` com `SIGNUP_ALLOWED_DOMAINS`. Um provedor OpenID Connect
(Keycloak, Authentik, Entra ID, Okta…) é configurado com as variáveis `OIDC_*`; Google, GitHub e Microsoft
com os respectivos `<PROVIDER>_CLIENT_ID` e `<PROVIDER>_CLIENT_SECRET`. URI de redirecionamento:
`<RONDE_URL>/api/auth/callback/<provider>`.

## Transcrições sem enviar o áudio para fora

As transcrições (Team) usam um serviço de voz para texto compatível com a API da OpenAI. Para manter o áudio
nos seus servidores, inicie o perfil `whisper` e aponte o Ronde para ele:

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

Com uma licença Team ou Enterprise, os espaços de trabalho podem adicionar o Ronde ao Slack: lembretes de
ficha por mensagem direta, fichas preenchidas em um formulário do Slack, notificações em um canal e o
comando `/ronde`. A instância precisa do próprio app do Slack, criado uma única vez. O Slack precisa
conseguir acessar a `RONDE_URL` por HTTPS.

1. Baixe o manifesto do app e troque nele cada `https://ronde.example.com` pela sua `RONDE_URL`:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. Em [api.slack.com/apps](https://api.slack.com/apps): **Create New App › From a manifest**, escolha seu
   espaço do Slack e cole o arquivo.
3. Copie as chaves de **Basic Information › App Credentials** para o `.env` (`SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`) e execute `docker compose up -d`.
4. No Ronde, um proprietário ou administrador de cada espaço abre **Configurações › Slack › Adicionar ao Slack**.

Para adicionar o app a vários espaços do Slack, ative **Manage Distribution** nas configurações do app.

## Microsoft Teams

Com uma licença Team ou Enterprise, os espaços de trabalho podem adicionar o Ronde ao Microsoft Teams:
lembretes de ficha por mensagem pessoal, fichas preenchidas a partir de um cartão, notificações em um canal e o
comando `ronde`. A instância precisa do seu próprio app do Teams, um Azure Bot registrado uma vez na sua
organização Microsoft. A Microsoft precisa conseguir acessar a `RONDE_URL` por HTTPS.

1. No [portal do Azure](https://portal.azure.com): **Create a resource › Azure Bot**, com um identificador
   (`ronde`), o plano gratuito **F0**, **Type of App: Single Tenant** e **Create new Microsoft App ID**.
2. No bot, **Settings › Configuration**: defina o **Messaging endpoint** como
   `https://ronde.example.com/api/teams/messages` (o seu `RONDE_URL`), salve e copie o **Microsoft App ID** e o
   **App Tenant ID**.
3. **Manage Password**, na mesma página, abre o registro do aplicativo: **Certificates & secrets › New client
   secret**, e copie o **Value** (exibido uma única vez).
4. No bot, **Settings › Channels**: adicione **Microsoft Teams** e aceite os termos.
5. Coloque os três valores no `.env` (`TEAMS_APP_ID`, `TEAMS_TENANT_ID`, `TEAMS_APP_PASSWORD`) e execute
   `docker compose up -d`.
6. No Ronde, um proprietário ou administrador de um espaço abre **Configurações › Microsoft Teams** e
   baixa o app. Um administrador do Teams o carrega (Centro de administração do Teams › Aplicativos do Teams ›
   Gerenciar aplicativos › Carregar novo aplicativo) e o adiciona a uma equipe: o Ronde publica um cartão no
   canal, e **Vincular ao Ronde** escolhe o espaço.

O segredo do cliente expira em 6 a 24 meses: crie um novo antes que ele expire e substitua `TEAMS_APP_PASSWORD`. Um bot
single-tenant atende as pessoas da sua própria organização Microsoft; para oferecer o app a outras
organizações, ele precisa ser publicado na Teams Store.

## Atualizar

```sh
docker compose pull && docker compose up -d
```

O contêiner `migrate` aplica as migrações da nova versão antes de o app iniciar. Fixe uma versão com
`RONDE_VERSION=1.0.0-beta.3` no `.env` para escolher quando atualizar.

## Backups

Tudo fica no volume do PostgreSQL:

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## Imagens

| Imagem | O que é |
|---|---|
| `ghcr.io/joinronde/ronde` | O app, todas as edições (recursos pagos desativados sem licença) |
| `ghcr.io/joinronde/ronde-ce` | O app sem o código das edições pagas (somente AGPL) |
| `ghcr.io/joinronde/ronde-migrate` | As migrações do banco de dados da mesma versão |

Toda variável secreta também aceita `<NAME>_FILE` (secrets do Docker). Educação: escolas e universidades
recebem os planos pagos de graça; peça em https://joinronde.com/pt/education.
