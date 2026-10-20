# 自托管 Ronde

Ronde 可以运行在任何装有 Docker 的机器上：应用本体、一个 PostgreSQL 数据库，以及一个负责应用每个版本数据库迁移的一次性容器。社区版的全部功能都免费，会议和人数不受限制。许可证密钥可开启 Team 或 Enterprise 功能。

## 开始

1. 获取文件：

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. 填写 `.env`：大家将访问的地址（`RONDE_URL`）和三个密钥。

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. 启动：

   ```sh
   docker compose up -d
   ```

4. 打开 `RONDE_URL` 并创建第一个账户：它将成为该实例的管理员。

## HTTPS

将域名指向这台机器，在 `.env` 中设置 `RONDE_DOMAIN=ronde.example.com` 和 `RONDE_URL=https://ronde.example.com`，然后使用 `https` 配置文件启动。Caddy 会获取并续期证书。

```sh
docker compose --profile https up -d
```

如果使用你自己的反向代理，请转发到 `RONDE_PORT` 端口（默认 3000），并保留 `X-Forwarded-*` 请求头。Server-Sent Events 不能被缓冲（nginx 中设置 `proxy_buffering off`）。

## 邮件

登录链接、邀请和提醒需要 SMTP 服务器：`SMTP_URL=smtp://user:password@smtp.example.com:587` 和 `MAIL_FROM`。试用时，`mail` 配置文件会启动 Mailpit，拦截所有邮件：

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

要让成员通过回复提醒邮件来填写进展卡，请给 Ronde 一个可读取的邮箱：`INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX`；登录名不是邮箱地址时，再设置 `INBOUND_ADDRESS`。回复会发送到这个邮箱；Ronde 每分钟读取回复提醒的邮件，把其中的条目加入进展卡，发邮件确认，并将其移到 `Ronde` 文件夹。邮箱中的其他邮件保持原样，因此它可以就是你平时的联系地址。

推送通知（快轮到你时、进展卡提醒、铃铛中的消息）需要为实例准备一对密钥：`npx web-push generate-vapid-keys`，然后设置 `WEB_PUSH_PUBLIC_KEY` 和 `WEB_PUSH_PRIVATE_KEY`。请妥善保存：已开启通知的设备依赖这对密钥。Ronde 必须通过 HTTPS 提供服务；在 iPhone 上需先将其添加到主屏幕。

## 登录

本地账户和邮件登录链接开箱即用。`SIGNUP_POLICY` 决定谁可以创建账户：`invite-only`（默认）、`open`，或配合 `SIGNUP_ALLOWED_DOMAINS` 使用 `domains`。一个 OpenID Connect 提供方（Keycloak、Authentik、Entra ID、Okta……）通过 `OIDC_*` 变量配置；Google、GitHub 和 Microsoft 则通过各自的 `<PROVIDER>_CLIENT_ID` 和 `<PROVIDER>_CLIENT_SECRET` 配置。重定向 URI：`<RONDE_URL>/api/auth/callback/<provider>`。

## 不外传音频的转写

转写（Team）使用兼容 OpenAI API 的语音转文字服务。若要让音频留在你的服务器上，请启动 `whisper` 配置文件并让 Ronde 指向它：

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

拥有 Team 或 Enterprise 许可证后，工作空间可以将 Ronde 添加到 Slack：私信发送进展卡提醒、在 Slack 表单中填写进展卡、在频道中接收通知，以及 `/ronde` 命令。实例需要自己的 Slack 应用，只需创建一次。Slack 必须能通过 HTTPS 访问 `RONDE_URL`。

1. 获取应用清单，并将其中每个 `https://ronde.example.com` 替换为你的 `RONDE_URL`：

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. 在 [api.slack.com/apps](https://api.slack.com/apps)：**Create New App › From a manifest**，选择你的 Slack 工作区并粘贴该文件。
3. 将 **Basic Information › App Credentials** 中的密钥复制到 `.env`（`SLACK_CLIENT_ID`、`SLACK_CLIENT_SECRET`、`SLACK_SIGNING_SECRET`），然后运行 `docker compose up -d`。
4. 在 Ronde 中，每个工作空间的所有者或管理员打开**设置 › Slack › 添加到 Slack**。

如需将应用添加到多个 Slack 工作区，请在应用设置中开启 **Manage Distribution**。

## Microsoft Teams

拥有 Team 或 Enterprise 许可证后，工作空间可以将 Ronde 添加到 Microsoft Teams：通过私信发送进展卡提醒、从卡片填写进展卡、在频道中接收通知，以及使用 `ronde` 命令。实例需要自己的 Teams 应用，即在你的 Microsoft 组织中注册一次的 Azure Bot。Microsoft 必须能通过 HTTPS 访问 `RONDE_URL`。

1. 在 [Azure 门户](https://portal.azure.com)中：**Create a resource › Azure Bot**，填写标识（`ronde`），选择免费的 **F0** 方案、**Type of App: Single Tenant** 和 **Create new Microsoft App ID**。
2. 在机器人的 **Settings › Configuration** 中：将 **Messaging endpoint** 设为 `https://ronde.example.com/api/teams/messages`（你的 `RONDE_URL`），保存，并复制 **Microsoft App ID** 和 **App Tenant ID**。
3. 同一页面的 **Manage Password** 会打开应用注册：**Certificates & secrets › New client secret**，然后复制其 **Value**（只显示一次）。
4. 在机器人的 **Settings › Channels** 中：添加 **Microsoft Teams** 并接受其条款。
5. 将这三个值写入 `.env`（`TEAMS_APP_ID`、`TEAMS_TENANT_ID`、`TEAMS_APP_PASSWORD`），然后运行 `docker compose up -d`。
6. 在 Ronde 中，工作空间的所有者或管理员打开**设置 › Microsoft Teams** 并下载应用。Teams 管理员上传它（Teams 管理中心 › Teams 应用 › 管理应用 › 上传新应用）并将其添加到团队：Ronde 会在该团队的频道中发布一张卡片，点击**关联到 Ronde**即可选择工作空间。

客户端密钥会在 6 到 24 个月后过期：请提前创建新的密钥并替换 `TEAMS_APP_PASSWORD`。单租户机器人为你自己 Microsoft 组织中的成员服务；若要向其他组织提供该应用，需要将其发布到 Teams 应用商店。

## 升级

```sh
docker compose pull && docker compose up -d
```

`migrate` 容器会在应用启动前应用新版本的迁移。在 `.env` 中用 `RONDE_VERSION=1.0.0-beta.3` 固定版本，即可自行决定何时升级。

## 备份

所有数据都在 PostgreSQL 卷中：

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## 镜像

| 镜像 | 说明 |
|---|---|
| `ghcr.io/joinronde/ronde` | 应用本体，包含所有版本（没有许可证时付费功能关闭） |
| `ghcr.io/joinronde/ronde-ce` | 不含付费版本代码的应用（仅 AGPL） |
| `ghcr.io/joinronde/ronde-migrate` | 同一版本的数据库迁移 |

每个密钥变量也接受 `<NAME>_FILE` 形式（Docker secrets）。教育：学校和大学可免费使用付费方案，请在 https://joinronde.com/zh/education 申请。
