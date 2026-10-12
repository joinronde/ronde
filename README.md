<p align="center">
  <img src="apps/web/public/icon.svg" width="84" height="84" alt="" />
</p>

<h1 align="center">Ronde</h1>

<p align="center">
  <strong>Meetings where everyone gets their turn.</strong><br />
  Check-ins written beforehand, a timed round table on the shared screen, a round per project,<br />
  and minutes that are ready when the meeting ends.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-b53b0a" alt="License: AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/status-beta-b07a08" alt="Status: beta" />
  <a href="docs/self-hosting/README.md"><img src="https://img.shields.io/badge/self--host-Docker%20Compose-0c6a82" alt="Self-host with Docker Compose" /></a>
  <img src="https://img.shields.io/badge/languages-10-13723a" alt="Ten languages" />
</p>

<p align="center">
  <a href="https://joinronde.com">Website</a> ·
  <a href="https://joinronde.com/en#video">Video</a> ·
  <a href="docs/self-hosting/README.md">Self-host</a> ·
  <a href="docs/administration/README.md">Guide</a> ·
  <a href="https://joinronde.com/en/pricing">Pricing</a>
</p>

<p align="center">
  <a href="https://joinronde.com/en#video"><img src="docs/media/video.webp" width="860" alt="Watch Ronde in one minute: a whole weekly meeting, from the check-ins to the minutes" /></a>
</p>

Ronde runs a team's recurring meetings: the weekly sync, the stand-up, the project review. The host drives the meeting from the **control room** and shares the **shared screen** tab in the video call. Everyone follows on **My screen**: they fill in their check-in beforehand, follow the live meeting, raise their hand, ask questions and react.

> Ronde is open-core: a free self-hosted Community Edition (AGPL-3.0), and Team and Enterprise plans in the cloud or with a license key. Schools and universities get the paid plans for free.

## Why Ronde

- **The weekly meeting drags on**: each person gets a timed turn on the shared screen, and the host moves on with one key.
- **Nobody prepared their update**: everyone fills in a two-minute check-in beforehand, from a phone or a computer, and last week's plan is there to tick off.
- **Nobody writes the minutes**: decisions and actions are noted as the meeting goes, and the minutes are ready when it ends. Actions come back every week until they are done.
- **It still feels like a team meeting**: reactions, raised hands, kudos, a wheel to pick who goes next, the team's mood.

<p align="center">
  <img src="docs/media/session.webp" width="860" alt="The shared screen of a Ronde meeting, moving from one person's turn to the next" />
</p>

## Before, during, after

**Before.** Each person writes what they did, what they plan and what blocks them, from a computer or a phone. What was planned last time comes back to be ticked off.

**During.** The shared screen gives each person their turn, with a timer and their check-in on display. The host moves on with one key, takes notes, turns blockers into actions, and can spin a wheel or toss a coin in front of everyone.

**After.** The minutes are written from the check-ins, the notes and the decisions, ready to send as Markdown or PDF. Actions come back every week until they are done, and the stats show planned against done.

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/media/control-dark.webp" />
        <img src="docs/media/control.webp" alt="The control room: the current turn, its timer, notes for the minutes and the agenda" />
      </picture>
      <p align="center"><sub>The control room</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/media/screen-dark.webp" />
        <img src="docs/media/screen-turn.webp" alt="The shared screen during a person's turn: done, planned and blockers" />
      </picture>
      <p align="center"><sub>The shared screen</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/media/portfolio-dark.webp" />
        <img src="docs/media/portfolio.webp" alt="The project portfolio, grouped by theme, with the health of each project" />
      </picture>
      <p align="center"><sub>The project portfolio</sub></p>
    </td>
    <td width="50%">
      <img src="docs/media/minutes.webp" alt="Minutes of a past meeting: decisions, team mood and the round table" />
      <p align="center"><sub>The minutes</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/media/screen-wheel.webp" alt="A wheel spun in front of the shared screen to pick who speaks next" />
      <p align="center"><sub>Random draws, in front of everyone</sub></p>
    </td>
    <td width="50%" align="center">
      <img src="docs/media/phone.webp" width="240" alt="My screen on a phone: the live meeting, reactions and raised hands" />
      <p align="center"><sub>My screen, on a phone</sub></p>
    </td>
  </tr>
</table>

## Self-host in two minutes

```bash
mkdir ronde && cd ronde
curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
# fill in RONDE_URL and the three secrets of .env, then
docker compose up -d
```

HTTPS, email, single sign-on, local transcripts, upgrades and backups: see the [self-hosting guide](docs/self-hosting/README.md). Ronde is in beta: `RONDE_VERSION=beta` follows the latest one, `RONDE_VERSION=1.0.0-beta.N` holds a version.

## Editions

| | Community | Team | Enterprise |
|---|---|---|---|
| Meetings, check-ins, shared screen, control room, minutes, actions, stats | ✓ | ✓ | ✓ |
| Projects, portfolio and project round, import from GitHub, GitLab, Jira and Linear | ✓ | ✓ | ✓ |
| Modules: icebreaker, mood, usefulness vote, kudos, polls, retro, planning poker, random draws, sounds, GitLab and GitHub | ✓ | ✓ | ✓ |
| Workspace and portfolio dashboards, scheduled reports | | ✓ | ✓ |
| Workflows, AI assistant, transcription, calendar sync and video rooms, Slack app, tickets from actions, minutes in Notion and Confluence, imported projects kept in sync, custom logo, audit log of 90 days | | ✓ | ✓ |
| SAML, LDAP, SCIM, enforced SSO, domain capture, custom roles, programmes and per-project rights, full audit history streamed to a SIEM | | | ✓ |

The Community Edition is the whole product for a team, free and self-hosted. Team and Enterprise run in the cloud or on your servers with a license key; schools and universities get them for free. Prices are on [joinronde.com](https://joinronde.com/pricing).

## Features

<details>
<summary>Everything Ronde does, in detail</summary>

#### Meetings

- **Agenda**: intro and announcements, a timed round table (2 minutes each by default), a round per project, open topics, then wrap-up. Blocks can be added, reordered and timed.
- **Control room**: next and previous (← →), timer (Space), +30 s, speaking order to edit or shuffle, absences, raised hands and questions, spotlight, notes per step with decisions and actions. A guided tour shows it on the first visit.
- **Shared screen**: a waiting screen with a countdown, an intro sequence, each person's turn with their check-in, the project steps, an animated recap at the end. Sounds, music and seasonal ambiences are optional.
- **My screen**: each person fills in their check-in, follows the live meeting, raises their hand, asks a question, reacts, votes on topics and rates the meeting, from a computer or a phone.
- **Modules**, turned on per meeting: icebreaker, team mood, usefulness vote, kudos, spotlight, birthdays, rotating facilitator and note-taker, random draws (wheel, coin, teams), polls, retrospectives, planning poker, asynchronous check-ins.

#### Check-ins, minutes and follow-up

- **Check-ins with sections**: done, planned, blockers, other or custom, each a list, a checklist or free text. What was planned last time comes back to be ticked off. A reply to the reminder email can fill it in.
- **Minutes**, written from the check-ins, the notes and the decisions, with a summary on top; searched across every session, exported as Markdown, PDF or published to Notion and Confluence.
- **Follow-up actions**: a blocker becomes an action with an owner; it comes back every week until it is done, and can open a ticket in Jira, Linear, GitLab or GitHub.
- **Stats**: planned against done, attendance, turns on time, speaking time, recurring blockers, action resolution time; CSV exports.

#### Projects

- **Portfolio**: every project of the workspace with its logo, theme, health, lead, members, dates and links.
- **Project round**: a meeting follows projects; in the project round, the people of a project speak together from a shared sheet.
- **Project page**: description, the meetings following it, open actions, decisions, and what every session said about it.
- **Import**: repositories of a GitHub organization or projects of a GitLab group (or their milestones), Jira epics and Linear projects, with their description and logo. With Team, through a saved issue tracker, their name, status, dates and progress stay in sync.

#### Scheduling and notifications

- **Flexible schedule**: several patterns per meeting (every week, every other week, the first Monday of the month…), any date skipped or moved, time zones and daylight saving handled; public holidays skipped per country.
- **Calendars**: private ICS feeds; with Team, sessions synced both ways with Google, Microsoft 365 or CalDAV calendars (moves, cancellations and answers made there come back) and video rooms created for each meeting.
- **Reminders and notifications**: email, push notifications of the installable app, and connectors to Matrix, Slack, Microsoft Teams, Discord, Mattermost or a signed webhook. Team adds the Slack app and, on self-hosted servers, the Microsoft Teams app.

#### Accounts and workspaces

- **Sign-in**: email and password, email links, passkeys, Google, GitHub, Microsoft and OpenID Connect, with two-step verification. Enterprise adds SAML, LDAP, SCIM, domain capture and enforced single sign-on.
- **Workspaces**: a directory of people shared by every meeting, roles for the workspace (owner, admin, member, guest) and the meeting (host, co-host, participant, observer), an audit log with Team; Enterprise adds custom roles and streams the whole audit history to a SIEM.
- **Ten languages**: English, Chinese, Hindi, Spanish, Arabic (right to left), French, Portuguese, Russian, German and Italian. Each person picks theirs; the team has its own for emails and minutes.

</details>

## Monorepo

```
apps/web             the Ronde product (Next.js 16, React 19)
packages/config      shared TypeScript presets
packages/core        framework-free domain logic: agenda, minutes, stats, permissions, emails
packages/db          Prisma schema, migrations, client and the workspace-scoped client
packages/editions    plans and the features each one includes (gating, catalog, pricing page)
packages/module-sdk  what a module is made of: defineModule, defineOp, errors, real-time events
packages/modules     Community Edition modules (icebreaker, mood, kudos, raised hands, sounds, GitLab…)
packages/i18n        locales, message catalogs (ten languages, Arabic right to left) and Intl formatters
packages/jobs        background jobs on PostgreSQL (pg-boss)
packages/random-core seeded random engines (wheel, teams, race)
packages/ui          design tokens, base styles and shared React components
ee/                  code of the paid editions, under the Ronde Enterprise License
ee-stub/             what a pure Community build uses in its place
docker/              Dockerfile (web and migrate images), compose files, entrypoint
docs/                self-hosting and administration guides (also published on the site), README pictures
```

## Architecture

| Part | Choice |
|---|---|
| App | Next.js 16 (App Router, `standalone` output), React 19, TypeScript |
| Database | PostgreSQL 17, Prisma 7 (`pg` adapter, no binary engine) |
| Sign-in | Better Auth: accounts, email links, social and OIDC sign-in, two-step verification. Instances behind an authenticating proxy can trust its email header instead. |
| Tenancy | Every workspace row carries `workspaceId`; queries go through a Prisma extension that adds and enforces it, and composite foreign keys forbid links across workspaces. An isolation test calls every operation with another meeting's ids. |
| Real time | Server-Sent Events per meeting. Each change sends a PostgreSQL `NOTIFY` tagged with its meeting, relayed by every instance: several replicas work without sticky sessions. |
| Schedule | Recurrence engine on Temporal (local dates, then instants in the meeting time zone), checked against the rrule library in tests |
| Background jobs | pg-boss on the same PostgreSQL (schema `pgboss`): reminders every minute, daily notifications and next sessions every hour, message deliveries with retries; each tick runs once across replicas |
| Records | An archived session keeps a versioned record (`{ "v": 1, … }`, checked with zod); older formats are read through a migration chain. Check-in items are rows, so stats and comments point at items, not at their text. |
| Notifications | An event becomes one delivery per matching rule, with a unique key (rule, event, session or day): it goes out once, even from several replicas, and failed sends are retried. Webhooks carry `X-Ronde-Signature: sha256=<HMAC of "timestamp.body">`. |
| i18n | next-intl, messages in `packages/i18n/messages/<locale>/` |
| PDF | Generated in the browser (jsPDF) |

Every change of a meeting goes through `POST /api/w/<workspace>/m/<meeting>/rpc`. Modules declare their own operations, prefixed with their id (`kudos.add`); an operation of a module turned off is refused. Operations are declared in a registry (`defineOp`): each one names its permission and its input schema (zod), and runs in a transaction confined to the workspace, with the current session locked when it needs it. The change is then broadcast to the browsers following the meeting.

## Local development

Requirements: Node.js 22, pnpm 10, Docker.

```bash
make dev
```

`make dev` creates `apps/web/.env` from `.env.example` if needed and installs dependencies. It then starts PostgreSQL (Docker, port 5434), applies migrations, loads the demo workspace on first run, and serves the app on http://localhost:3000. Ctrl+C stops the server and PostgreSQL; data is kept. `make help` lists the other commands.

Sign in as `host@example.com` with the password `ronde-demo-password`: the demo workspace has a directory of six people and a weekly meeting with two months of history. You can also create your own account. Without `SMTP_URL`, emails (verification, sign-in links, invitations) are written to the server log.

Checks: `make lint`, `make typecheck`, `make test`, `make test-integration`, `make e2e` (Playwright), `make build`, and `pnpm check:english` (no French outside the French catalogs). While `make dev` runs, browser tests can use the production build instead: `pnpm build`, then `E2E_BUILD=1 pnpm --filter @ronde/web e2e` (`next dev` runs once per project).

The pictures of this README come from the app itself: after `pnpm build`, `MEDIA_DATABASE_URL=postgres://…/ronde_media pnpm --filter @ronde/web media` recreates the demo workspace in that database (keep one for this), takes the screenshots in light and dark and films the round table frame by frame. Run it again when the screens change.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:password@host:5432/ronde` |
| `APP_URL` | recommended | Public URL, prefix included, for links in reminders |
| `DEFAULT_LOCALE` | no | `en` (default) or another supported language (`zh`, `hi`, `es`, `ar`, `fr`, `pt`, `ru`, `de`, `it`), used when neither the viewer nor their browser picks one |
| `AUTH_SECRET` | yes (production) | Signs sessions and email links, at least 32 characters |
| `SIGNUP_POLICY` | no | `invite-only` (default), `open` or `domains` |
| `SIGNUP_ALLOWED_DOMAINS` | no | Domains allowed to sign up with `SIGNUP_POLICY=domains`, comma separated |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | no | Single sign-on with an OpenID Connect provider; redirect URI `<APP_URL>/api/auth/callback/oidc` |
| `OIDC_DISPLAY_NAME`, `OIDC_SCOPES`, `OIDC_DISCOVERY_URL` | no | Button label (`SSO`), scopes (`openid profile email`), discovery document |
| `GOOGLE_*`, `GITHUB_*`, `MICROSOFT_*` `_CLIENT_ID` / `_CLIENT_SECRET` | no | Social sign-in; redirect URI `<APP_URL>/api/auth/callback/<provider>` (`MICROSOFT_TENANT_ID`, default `common`) |
| `AUTH_TRUSTED_EMAIL_HEADER` | no | Behind an authenticating proxy only: header with the signed-in email; accounts are created on first visit |
| `SMTP_URL`, `MAIL_FROM` | recommended | Sign-in links, address verification, invitations and reminders |
| `INBOUND_IMAP_URL`, `INBOUND_ADDRESS` | no | Mailbox read every minute (`imaps://user:password@host:993/INBOX`): a reply to a reminder fills the check-in; the address replies go to, when the login is not one |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` | no | Keys of the push notifications (`npx web-push generate-vapid-keys`); `WEB_PUSH_SUBJECT` is the contact given to the push services (`mailto:` the sender by default) |
| `SECRET_KEY` | recommended | Encryption key of the tokens stored in the database (at least 32 characters). **Do not change it**: saved tokens would become unreadable |
| `RONDE_JOBS` | no | `off` runs no background job in this process (another process runs them) |
| `RONDE_SITE_URL` | no | Public site presenting the plans (`https://joinronde.com` by default) |
| `RONDE_HIDE_UPGRADE_HINTS` | no | `1` hides every mention of the paid plans (self-hosted instances) |
| `GITLAB_URL`, `GITLAB_TOKEN` | no | GitLab instance, and the token used by meetings that set none (`read_api` scope) |
| `NEXT_PUBLIC_BASE_PATH` | no | **At build time**: URL prefix, e.g. `/ronde` |

Secrets (`DATABASE_URL`, `SMTP_URL`, `INBOUND_IMAP_URL`, `WEB_PUSH_PRIVATE_KEY`, `GITLAB_TOKEN`, `SECRET_KEY`, `AUTH_SECRET`, `RONDE_LICENSE`, `ANTHROPIC_API_KEY`, `TRANSCRIPTION_API_KEY`, the Stripe keys and the `*_CLIENT_SECRET` values) also accept a `<NAME>_FILE` form for Docker secrets.

## Docker

```bash
make docker-build   # ghcr.io/joinronde/ronde:dev and ghcr.io/joinronde/ronde-migrate:dev
```

The `migrate` image runs `prisma migrate deploy` once per release; the `web` image serves the app on port 3000 (health probe: `GET /api/health`). `--build-arg RONDE_PURE_CE=1` builds the app without the code of the paid editions. Ronde is in beta: every push to `main` builds the `:staging` images (`.github/workflows/app.yml`), and a beta is published by hand from Actions › Release, which tags `v1.0.0-beta.N` and pushes `ronde`, `ronde-ce` and `ronde-migrate` for amd64 and arm64 to GHCR with that version and `:beta` (`.github/workflows/release.yml`). The Ronde team's own servers follow those tags (`:staging`, then `:beta` in production): publishing is deploying.

## License

The Ronde core is licensed under the [GNU AGPL v3](LICENSE). The code in `ee/`, which the Team and Enterprise plans unlock, is under the [Ronde Enterprise License](ee/LICENSE); a pure Community build (`RONDE_PURE_CE=1`) leaves it out.

## Sound credits

Recorded soundboard sounds are in `apps/web/public/sounds/`, trimmed and loudness-matched. None requires attribution; here it is anyway.

| File | Source | Licence |
|---|---|---|
| `drumroll.mp3` | “Drum Roll Intro”, Wikimedia Commons | CC0 |
| `ba-dum-tss.mp3` | “Sting”, Wikimedia Commons | Public domain |
| `tada.mp3` | “Music Jingles” (`jingles_PIZZI10`), Kenney.nl | CC0 |
| `applause.mp3` | “Applause #1” (s2363), Joseph Sardin, BigSoundBank.com | CC0 |

Recorded waiting music is in `apps/web/public/music/`, brought to -16 LUFS with fades at both ends. Works and recordings are free. *Traveling in your mind* is also the music of the site's promo videos.

| File | Work and recording (Wikimedia Commons) | Licence |
|---|---|---|
| `satie-gymnopedie-1.mp3` | Erik Satie, *Gymnopédie No. 1*, piano, clicks and hiss removed | CC0 |
| `satie-gymnopedie-1-guitar.mp3` | Erik Satie, *Gymnopédie No. 1*, guitar, Michael Laucke | Public domain |
| `debussy-clair-de-lune.mp3` | Claude Debussy, *Clair de lune*, piano solo (1905) | Public domain |
| `airmen-of-note-uno-mas.mp3` | Roger Hogan, *Uno Mas*, Airmen of Note, United States Air Force Band (1972) | Public domain (US Air Force work) |
| `loyalty-freak-music-traveling-in-your-mind.mp3` | Loyalty Freak Music, *Traveling in your mind* (Free Music Archive) | CC0 |
| `loyalty-freak-music-ghost-surf-rock.mp3` | Loyalty Freak Music, *Ghost Surf Rock* (Free Music Archive) | CC0 |
| `john-bartmann-secret-agent-rock.mp3` | John Bartmann, *Secret Agent Rock* (Free Music Archive) | CC0 |

## Data credits

Public holidays come from [date-holidays](https://github.com/commenthol/date-holidays) (code under the ISC licence); its holiday data, drawn from Wikipedia, is available under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) and is used unchanged. The settings that use it say so next to the choice of holidays.
