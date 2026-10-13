# Administering Ronde

This guide is for the people who run Ronde for an organisation: the administrator of a self-hosted
instance, and the owners and admins of a workspace (in the cloud or on your own server). To install
Ronde, start with the [self-hosting guide](../self-hosting/README.md).

## The instance

The first account created on a new instance becomes its **administrator**. The administrator opens
**Server administration** from the workspace menu, top left (`/admin`), where they can:

- see how many accounts, workspaces and meetings the instance holds;
- pick the default language, used when neither the person nor their browser asks for one Ronde speaks;
- decide who may create an account;
- enter or remove the license key.

Values saved on this page take precedence over the environment variables. Each workspace's own
settings (members, roles, security) stay in its **Settings**.

In the cloud, Ronde's team runs the server: there is no Server administration, anyone may create an
account, and each workspace's plan comes from its subscription.

### Who can create an account

| Policy | Who may sign up |
| --- | --- |
| On invitation (default) | Only people invited to a workspace |
| Email domains | Invited people, and anyone with an address of the listed domains |
| Open | Anyone who reaches the instance |

The same choice can be made with `SIGNUP_POLICY` (`invite-only`, `domains`, `open`) and
`SIGNUP_ALLOWED_DOMAINS`.

### License key

Team and Enterprise features turn on with a license key, set in Server administration or with the
`RONDE_LICENSE` variable (the variable wins and locks the field). The key is checked on the server,
offline: nothing is sent anywhere. The page shows the plan, the customer, the expiry date and how many
seats are used.

- **A seat** is a person who took part in a meeting in the last 30 days, as on Ronde's cloud. Someone invited
  who never came, or away for the month, uses none, and a person in several workspaces (with the same account,
  or the same address) counts once.
- **The highest count** of each license is kept while it works (active, or in its grace period), counted every
  night and on each visit of the page. It is what the renewal counts. A new key starts its own count, and the
  page still shows the previous license's highest count, to settle it.
- **More people than seats**: nothing is blocked. The page says so, and the difference is settled at the renewal.
- **Expired**: a grace period of 14 days keeps everything working. After it, the paid features become
  read-only: what they hold stays readable, nothing new can be added. Community features are never
  affected.
- The `ronde-ce` image is built from the open-source code alone and cannot read a license key: use the
  `ronde` image for Team or Enterprise.

Schools and universities get a free Enterprise license: write to hello@joinronde.com from your
institution's address.

### Hiding the paid plans

Admins see discreet hints about the paid features in the settings (never during a meeting). Set
`RONDE_HIDE_UPGRADE_HINTS=1` to remove them from the whole instance.

### Feedback from users

The speech-bubble button at the top of the pages (in the account menu on phones) lets people report a problem or
share an idea, with a screenshot if they want. With the message go the page's address (without its query), the
browser, the window size, the language and Ronde's version. The administrators read the messages in **Server
administration**, answer by email the people who asked for it, and can open a pre-filled issue on the Ronde project
for a problem of Ronde itself. When `SENTRY_DSN` is set, the messages also reach that Sentry project as user
feedback. Messages are deleted after a year; `RONDE_FEEDBACK=off` removes the button.

## Workspaces

A workspace holds a team's people, meetings, templates and connectors. Anyone allowed to sign up can
create one; a person can belong to several. Its settings are under **Settings** in the sidebar:

| Tab | What it holds | Who sees it |
| --- | --- | --- |
| General | Name, link, language, job categories, who may create meetings, connectors and integrations | Everyone; owners and admins change it |
| Security | Verified domains, identity providers, LDAP, SCIM | Owners and admins (Enterprise) |
| Roles | Custom roles | Owners and admins (Enterprise) |
| Audit log | Who changed what | Owners and admins (Team, Enterprise) |
| Billing | Plan and invoices | Owners and the Billing role, in the cloud |
| Plans | What Team and Enterprise add, and where to get them | Owners and admins, self-hosted |

### Roles

Each member has one workspace role:

| Role | Can |
| --- | --- |
| Owner | Everything, including billing and deleting the workspace |
| Admin | Everything but billing and deletion; acts as host of every meeting |
| Billing | The plan, the invoices and the payment method, nothing else (in the cloud) |
| Organizer | What a member can, plus creating meetings when they are kept to admins, and inviting people |
| Member | See the directory, create meetings (unless kept to organizers and admins), save templates |
| Guest | Only the meetings they are invited to |

Each person in a meeting also has a meeting role:

| Role | Can |
| --- | --- |
| Host | Run sessions, configure the meeting, manage its people, edit the minutes |
| Co-host | Run sessions and edit the minutes, without changing the meeting's settings or people |
| Participant | Fill in their check-in, take part in sessions, read the history |
| Observer | Follow sessions and read the history |

The person who creates a meeting is its host. With Enterprise, **custom roles** add permissions to
members and guests; their meeting permissions apply to every meeting of the workspace.

### People and invitations

The **directory** is shared by every meeting of the workspace: a person's name, birthday (day and month
only), job category and accounts on GitLab or GitHub are entered once. People can be added without an
account, for a meeting where they do not sign in; inviting them sends an email with a link valid for 14
days. Removing a member ends their access; their check-ins and history stay with the workspace. With
SCIM, people deactivated in your directory lose their access the same way.

### Absences

Each person can add their absences on their profile (people managers can do it for anyone): a first and a
last day, a note, and who runs the meetings they host meanwhile. During an absence the person is marked
absent from the sessions of those days, gets no reminders, and their profile shows when they are back. The
person named as a stand-in gets a notification and runs the meetings as their host, for those days only.

### Margin between meetings

In the General tab, **Margin between two meetings** (none, 5, 10, 15 or 30 minutes) is kept free before and
after each meeting of a person. "Find a slot" respects it, and the schedule of a meeting flags the dates
that come too close to another meeting of the same people.

## Sign-in and single sign-on

The Community edition offers email and password accounts, sign-in links by email, two-factor
authentication, Google, GitHub and Microsoft accounts, and one OpenID Connect provider for the instance
(`OIDC_*` variables, see the [self-hosting guide](../self-hosting/README.md)).

Each person manages how they sign in from their account, under **Sign-in and security**: password, passkeys (Face ID, Windows Hello, a password manager or a security key), two-step verification, and signing out everywhere. Passkeys are tied to the domain of `APP_URL`, which must use HTTPS: after a change of domain, people add them again. An address that must use single sign-on can neither add nor use a passkey.

With Enterprise, the **Security** tab of a workspace adds:

1. **Verified domains.** Add your email domain and the DNS record shown, then verify it. A verified domain
   can:
   - **capture new accounts**: anyone signing up with an address of the domain joins the workspace as a
     member;
   - **require single sign-on**: its addresses sign in with your provider only, with no password and no
     email link. Check that the provider works for you before turning this on.
2. **Identity providers**, OpenID Connect or SAML (Okta, Entra ID, Google Workspace, Keycloak…), for the
   addresses of your verified domains. The page gives the redirect URI or the reply URL (ACS) and the
   entity ID to enter on the provider's side.
3. **Company directory (LDAP or Active Directory).** People sign in with their directory password. Ronde
   looks them up with a service account and checks their password without keeping it. Use `ldaps://`, or
   `ldap://` with StartTLS.
4. **Provisioning (SCIM).** Your directory (Okta, Entra ID, JumpCloud…) creates people, keeps their name
   and address up to date, and removes them when they leave. The tab gives the SCIM endpoint and a token.

An instance behind an authenticating reverse proxy can trust the address it passes in a header instead
(`AUTH_TRUSTED_EMAIL_HEADER`); only do this when nothing else can reach Ronde.

## Meetings

Owners and admins can keep meeting creation to organizers and admins in the General tab. Each meeting then has its
own settings, open to its hosts: schedule, people and roles, check-in sections, agenda, modules,
appearance, notifications, video call and integrations. A meeting can be saved as a workspace template,
without its people, history or tokens.

A meeting starts with its template's emoji, shown next to its name in the menus; under Settings › Appearance, its hosts pick another emoji or upload an image (a logo, a team photo).

### Sessions on the spot

**Start now**, on a meeting's card, holds a session right away, outside the schedule: the team is told
(bell, and the "session started" notification rules), and the control room opens. The session is dated
today; the date it was planned for stays in the schedule. Starting from the control room a session prepared
for another day does the same.

### Sample meeting

Before its first meeting, a workspace's home offers a sample one: a weekly sync with a fictitious team of five, a month of archived sessions with their minutes, stats and actions, and a session ready to run, all in the workspace's language. It is there to try everything: it sends nothing (no reminder, email, calendar entry or notification), costs no seat, ticks none of the first steps and stays out of the workspace's insights and reports. A banner on its pages says so, and **Delete the sample** removes it for good with its fictitious team (someone of that team added to another meeting stays). Its people show as Sample in the directory and cannot be invited.

### Public holidays

In the General tab, a workspace picks the public holidays of a country, and of a region where they differ (a German state, a Spanish community…); a new workspace starts with those of its time zone's country. A session that falls on one of them is skipped: the next date is prepared, reminders and calendars follow, and the schedule names the holiday. In its schedule, a meeting can follow other holidays or none, and its host can still hold or move each skipped session. Holidays come from the date-holidays project, based on Wikipedia (CC BY-SA 3.0).

### Guest links

In a meeting's settings, **People › Guest links** creates a secret link for people without an account (a
client, a board, a partner). It opens the shared screen, live and read-only, until it expires (1 to 90
days) or a host revokes it. The link is shown once, when it is created; Ronde only keeps its hash.

### Projects and portfolio

The **Projects** page of a workspace holds its portfolio: each project, subject or workstream with a
one-line summary, a description, a theme, a status, a health (on track, at risk, off track), a lead, the
people working on it, dates and links. Members can create projects; their lead and the admins edit them.
A project's page gathers what every meeting said about it, session by session, for the people who can read
those meetings.

Each project can have a logo, beside its name and on its step in meetings: click its mark on the project's page to pick an image; without one, its initials stand on its colour. An import brings the tool's own image: a GitHub organization's avatar, a GitLab project's or a Jira project's. Those who can edit the project change or remove it.

A meeting follows projects in **Settings › Projects**. Each project followed gets a tab in everyone's
check-in, with a shared sheet: the health and the message of the day, written by the people working on it.
Add the **Project round** block to the agenda to give each project its own turn, where its people speak
together; without it, the items about a project are presented in each person's turn. The **Portfolio
review** and **Team and projects** templates start with it. With Team, a dashboard shows the health of
every project week by week, the due dates and the projects gone quiet, exports it as CSV and adds the
projects to watch to the email report. With Enterprise, a project can belong to another one, which becomes a programme (three levels at most), be seen by its members only, and let its members edit it, not only its lead.

**Import**, on the same page, brings projects from your tools: the repositories of a GitHub organization or the projects of a GitLab group, the milestones of a GitHub repository or a GitLab project (each named "repository · milestone"), the epics of a Jira project, or Linear's projects. Pick the ones to bring in; those already in the portfolio are recognised, and an item comes in once. The token typed there serves that import only and is not kept:

- GitHub: none for public repositories; for private ones, a fine-grained token that can read them (Metadata, and Issues for milestones).
- GitLab: none for public groups and projects; otherwise a personal, group or project access token with the `read_api` scope.
- Jira: an API token of the account whose email is given (id.atlassian.com › Security › API tokens).
- Linear: a personal API key.

Members import from github.com, gitlab.com, Atlassian Cloud and Linear; importing from another server (GitHub Enterprise, a self-managed GitLab, Jira Data Center) and through the issue trackers saved in the workspace settings is for the workspace's administrators. With Team, importing through such a tracker keeps the projects in sync every hour: their name, status, dates and progress follow the tool, what the tool does not give stays as set in Ronde (a repository gives its name, and is marked done once archived), and their progress shows on the cards and in meetings while it is current. The project's page offers **Update now** and **Stop syncing**. Sync stops for good with **Stop syncing**, when the tracker is removed or points to another server, and pauses while the workspace is not on Team. An item the tool no longer finds (deleted, or out of the token's reach) is tried again once a day. Archived projects are not updated until they are restored.

### Modules

Every facilitation module is free: icebreaker, team mood, usefulness vote, reactions, raised hands, kudos, spotlight,
wheel and random draws, birthdays, sounds, timebox, polls, parking lot, decision log, retrospective,
planning poker and async meetings. A module turned off in a meeting disappears from its control room,
shared screen and check-ins; its settings are kept.

The usefulness vote asks everyone, at the wrap-up, how useful the meeting was (1 to 5 stars, from their screen or phone). The average shows from 3 ratings, so that no one's rating can be guessed; it goes into the minutes and the stats. The templates of short daily meetings, one-on-ones and formal bodies (steering committee, boards, class council, site meeting, case review, incident review) leave it off.

### Exports

Pages that list things export them for a spreadsheet: **Export as CSV** on the Actions page (every action
of the view, also those done more than two weeks ago), the Decisions page (with its search and meeting
filter), a meeting's Stats (one line per session) and, with Team, the Insights table and the portfolio
dashboard. Minutes download as Markdown or PDF from the History. The files open straight into columns in
Excel, LibreOffice or Numbers, in the person's language (";" and a decimal comma in French, German,
Spanish, Italian, Portuguese and Russian), and a text that looks like a formula stays text.

## Notifications

**Connectors** are the channels where meetings can post: email, Matrix (Tchap), Slack, Microsoft Teams,
Discord, Mattermost, or a webhook signed with HMAC. Owners and admins add them in the General tab of the
workspace. Each meeting then chooses, in its Notifications settings, which events go to which connector:
a session soon, started or ended, minutes published, a check-in reminder, an overdue action, a birthday.

Every Monday from 08:00 (workspace time zone), each member gets a **weekly summary** by email: their sessions
of the week with a link to each check-in, their open follow-up actions and the kudos they received. It is sent
only when there is something in it; each person turns it off in their account or with the link at the bottom
of the email. On a self-hosted instance it needs `SMTP_URL`; `RONDE_WEEKLY_PER_RUN` (150 by default) caps the
emails sent per hour, the others go the next hour.

With Team, notification workflows add conditions and your own wording to each message, and two more connectors
send **SMS** and **WhatsApp** messages through Twilio: enter the Account SID, the sender number and the auth
token. Messages go to the mobile numbers people enter on their profile (international form, +33…), and never
to people who are away. For WhatsApp, the sender must be approved in Twilio, and WhatsApp only lets a business
write first with a template Meta approved: create one in Twilio's Content Template Builder with two variables
(the message, then the link) and enter its Content SID in the connector. When a workspace leaves Team, these
messages stop and the log of each meeting says why.

**Check-in by email**: when the instance reads a mailbox (`INBOUND_IMAP_URL`, see the self-hosting guide), the reminder says that a reply works. Each section's name on a line, the items under it: the lines are added to the person's check-in (never replacing anything), and an email confirms what went in. Only replies from the address the reminder went to (or the person's account) count, for 14 days; observers and the sample meeting are left out.

**Push notifications**: once the instance has its keys (see the self-hosting guide), everyone can install Ronde from their browser (or add it to an iPhone's home screen) and, in their account, turn notifications on for each device: their turn coming up during a live session, check-in reminders, and what lands in the bell. Each kind can be turned off, and the devices are listed there.

## Integrations

Tokens and secrets entered in Ronde are encrypted with `SECRET_KEY` before they are stored, and never
shown again. Keep that key safe: without it, they cannot be read back.

The tokens of accounts signing in with Google, GitHub, Microsoft or single sign-on are encrypted too, with `AUTH_SECRET`.

| Integration | Where | Plan |
| --- | --- | --- |
| GitLab and GitHub: import issues and merge requests into check-ins | Meeting settings | Community |
| Video call: any link, Jitsi, BigBlueButton | Meeting settings | Community |
| Zoom, Google Meet and Teams rooms created for each meeting | Workspace, General | Team |
| Google, Outlook and CalDAV calendars (iCloud, Fastmail, Nextcloud…), both ways: sessions written into the participants' calendars, moves, deletions and answers made there brought back, availability read | Workspace, General | Team |
| Jira, Linear, GitLab and GitHub tickets from follow-up actions, closed in step | Workspace, General | Team |
| GitHub, GitLab, Jira and Linear: repositories, milestones, epics and projects imported into the portfolio | Projects › Import | Community |
| Imported projects kept in sync with their tool: name, status, dates and progress | Projects › Import, through an issue tracker | Team |
| Your logo on the shared screen, in emails and minutes | Workspace, General | Team |
| Slack app: reminders by direct message, check-ins filled in from Slack, `/ronde`, a channel for notifications | Workspace, General | Team |
| Microsoft Teams app: reminders by personal message, check-ins filled in from Teams, `ronde`, a channel for notifications | Workspace, General | Team |
| Notion and Confluence: each session's minutes published as a page, updated with the summary | Workspace, General, then Meeting settings › Integrations | Team |

### Slack

With Team, owners and admins click **Add to Slack** in the General tab and pick the channel for
notifications. Then:

- check-in reminders arrive as direct messages, with a **Fill in my check-in** button that opens the
  meeting's sections in a Slack form; the answers are saved in Ronde as if typed on the page;
- the chosen channel becomes a connector, ready for the meetings' notification rules (minutes published,
  session soon…);
- `/ronde` shows each person their next sessions and open follow-up actions, visible to them only.

People are matched by email: their Slack account and their Ronde profile must share it. Those not found in
Slack keep the email reminder. **Disconnect** removes the app from Slack and deletes the notification rules
posting to its channel. On a self-hosted instance, the administrator first creates the instance's Slack
app (see the self-hosting guide).

### Microsoft Teams

An owner or admin downloads Ronde's app for Teams from the General tab; a Teams administrator uploads it to the
organization's apps and adds it to a team. In its channel, Ronde posts a card: **Link to Ronde** opens Ronde,
where the workspace is picked. From then on, check-in reminders go by personal message to the people found in
the team (matched by their email), with a button that turns the message into the check-in's form; writing
“ronde” to the app lists the person's next sessions and open actions; and the channel becomes a connector for
the meetings' notification rules. Removing the app from the team, or **Unlink** in Ronde, stops it all, and
reminders go back to email.

### Notion and Confluence

Owners and admins add a wiki in the General tab: a **Notion** page shared with an internal integration
(created at notion.so/profile/integrations; share the page with it from ••• › Connections), or a
**Confluence** space, in the cloud (site, space key, the account's email and an API token from
id.atlassian.com) or on a Data Center or Server (a personal access token). An optional parent page keeps the
minutes together. Each meeting then picks its wiki under Settings › Integrations: at each archive, the
minutes become a page named by the session's date and the meeting's name, with a link back to the history.
Editing the summary updates the page; earlier sessions are published from the history, where a failed
publication says why and can be tried again. Sample meetings publish nothing.

### AI assistant and transcripts

With Team, the **AI assistant** drafts the summary of a session and suggests follow-up actions; the host
reviews everything before it is saved. It uses an Anthropic API key: the instance's (`ANTHROPIC_API_KEY`)
or the workspace's own.

**Transcripts** turn what is said during a session into text, filed under each round-table turn (what is said outside the round table stays unattributed). They need a speech-to-text
service: OpenAI, or a Whisper server of your own (the `whisper` profile of the Compose file runs one on
the same machine). Each meeting must allow them in its settings, everyone sees a banner while a session
is recorded, and each person can leave their turns out. The sound is deleted as soon as it is
transcribed.

## Audit log

With Team, the **Audit log** tab lists who changed what in the workspace over the last 90 days: settings,
people, roles and meetings, with a CSV export. Enterprise keeps the whole history, and can send each entry,
signed, to a webhook connector for your SIEM or log platform.

## Backups and upgrades

Everything Ronde keeps is in its PostgreSQL database. The
[self-hosting guide](../self-hosting/README.md#backups) explains how to back it up, restore it and move
to a new version.
