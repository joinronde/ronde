// Demo data to try Ronde: pnpm db:seed
// Creates the account host@example.com (password below), a "Demo" workspace, its directory and a weekly
// meeting with two months of history. Refuses to run when the demo workspace exists (unless --force,
// which deletes it first, with the accounts of the demo team).
import "dotenv/config";
import type { RecordV1 } from "@ronde/core/record";
import { zonedInstant } from "@ronde/core/schedule";
import type { RecordCheckIn } from "@ronde/core/types";
import { DEFAULT_SECTIONS, itemsFromCheckIn, nextMonday } from "@ronde/core/util";
import { type Prisma, prisma } from "@ronde/db";
import { MODULES } from "@ronde/modules";
import { roundTableFaces } from "@ronde/ui/faces";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";

const HOST_EMAIL = "host@example.com";
const HOST_PASSWORD = "ronde-demo-password";
const SLUG = "demo";

/** The palette of the projects (light theme): a logo in each project's colour */
const PALETTE = [
  ["#e0693a", "#b53b0a"],
  ["#c08a2c", "#86590a"],
  ["#2f9a5c", "#13723a"],
  ["#e0458a", "#be185d"],
  ["#2a93b0", "#0c6a82"],
  ["#a8703c", "#7c4a1e"],
];

/** Simple marks, one per demo project: an API's layers, a path, a phone, a grid, a pulse, a question */
const GLYPHS = [
  '<rect x="68" y="72" width="120" height="22" rx="11"/><rect x="68" y="117" width="120" height="22" rx="11" opacity=".8"/><rect x="68" y="162" width="120" height="22" rx="11" opacity=".6"/>',
  '<circle cx="84" cy="172" r="20"/><circle cx="172" cy="84" r="20"/><path d="M84 152c0-48 88-20 88-68" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/>',
  '<rect x="88" y="56" width="80" height="144" rx="18" fill="none" stroke="#fff" stroke-width="16"/><circle cx="128" cy="174" r="9"/>',
  '<rect x="64" y="64" width="56" height="56" rx="14"/><rect x="136" y="64" width="56" height="56" rx="28" opacity=".85"/><rect x="64" y="136" width="56" height="56" rx="28" opacity=".85"/><rect x="136" y="136" width="56" height="56" rx="14"/>',
  '<path d="M52 136h40l18-44 32 92 22-62 14 14h26" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>',
  '<circle cx="128" cy="128" r="72" fill="none" stroke="#fff" stroke-width="16"/><path d="M106 110a22 22 0 1 1 30 21c-6 3-8 7-8 13" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/><circle cx="128" cy="170" r="9"/>',
];

const projectLogo = (i: number) => {
  const [light, dark] = PALETTE[i % PALETTE.length]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect width="256" height="256" rx="56" fill="url(#g)"/><g fill="#fff">${GLYPHS[i % GLYPHS.length]}</g></svg>`;
};

const TEAM: [string, string, string, string][] = [
  ["m1", "Emma Laurent", "Engineering", "Billing API"],
  ["m2", "Lucas Martin", "Product", "Customer onboarding"],
  ["m3", "Sarah Cohen", "Engineering", "Mobile app"],
  ["m4", "Tom Becker", "Design", "Design system"],
  ["m5", "Sofia Rossi", "Engineering", "Platform and observability"],
  ["m6", "Hugo Moreau", "Design", "Help center"],
];
const mail = (n: string) =>
  n
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim()
    .replace(/\s+/g, ".") + "@example.com";

const POOL: Record<string, string[]> = {
  m1: [
    "Invoice data model",
    "/invoices endpoint",
    "API key authentication",
    "OpenAPI documentation",
    "Filters by customer segment",
    "Load tests at 500 requests/s",
    "/payments v2 endpoint",
  ],
  m2: [
    "Onboarding funnel analysis",
    "Interviews with 5 new customers",
    "Welcome checklist spec",
    "In-app tour copy",
    "Activation metric dashboard",
    "Pricing page experiment",
  ],
  m3: [
    "Mockups approved with support",
    "React Native skeleton and CI",
    "Multi-step sign-up form",
    "Photo upload for receipts",
    "Offline mode for the dashboard",
  ],
  m4: [
    "Button and input tokens",
    "Dark theme palette",
    "Accessible focus states",
    "Data table component",
    "Usability tests with two pilot teams",
  ],
  m5: [
    "Grafana setup",
    "Log collection with Loki",
    "Automatic database backups",
    "Release runbook",
    "Ingress controller upgrade",
    "Expired certificates cleanup",
  ],
};
const COUNTS: Record<string, number[]> = {
  m1: [1, 1, 1, 0, 1, 1, 1, 1],
  m2: [0, 1, 1, 1, 0, 1, 1, 1],
  m3: [1, 1, 0, 1, 0, 1, 1, 0],
  m4: [1, 1, 0, 0, 1, 1, 1, 0],
  m5: [1, 1, 1, 0, 1, 0, 1, 1],
};
const CURRENT: Record<string, RecordCheckIn> = {
  m1: {
    done: ["Pagination of the /customers endpoint", "Fix for the CSV export timeout"],
    next: ["Redis cache on /invoices", "Integration tests for the export"],
    blockers: ["Still no access to the staging database, ticket pending with IT"],
    other: ["Off on Thursday afternoon (training)"],
  },
  m2: {
    done: ["Approval screen for account owners", "Email when a trial is about to expire"],
    next: ["User tests with 3 customer success managers", "Monthly export to the data warehouse"],
    blockers: ["The CRM API caps exports at 2,000 rows"],
    other: [],
  },
  m3: {
    done: ["Single sign-on (OIDC) on staging", "Upgrade to React Native 0.80 done"],
    next: ["Handle expired sessions", "Demo to the support team on Wednesday"],
    blockers: [],
    other: [],
  },
  m4: {
    done: ["New spacing scale", "Component guidelines v1"],
    next: ["Signature pad component"],
    blockers: ["We need a paid licence for the icon set we picked"],
    other: [],
  },
  m5: {
    done: ["Response-time dashboard in Grafana", "CI pipeline for the Billing API"],
    next: ["Alerts on 5xx errors"],
    blockers: [],
    other: [],
  },
  m6: { done: [], next: [], blockers: [], other: [] },
};
/** The portfolio: each person leads the project of their line in TEAM; some work on another one too */
const PROJECTS: Record<
  string,
  { theme: string; summary: string; description: string; target: string; health: "onTrack" | "atRisk" | "offTrack"; also: string[] }
> = {
  m1: {
    theme: "Platform",
    summary: "Invoices, payments and API keys for the customers' finance teams",
    description:
      "The **Billing API** replaces the CSV exports the finance teams of our customers rebuild by hand every month.\n\n- Invoices and payments over REST\n- API keys per customer\n- Load tested at 500 requests/s",
    target: "2026-12-15",
    health: "atRisk",
    also: ["m5"],
  },
  m2: {
    theme: "Product",
    summary: "From sign-up to the first meeting run in under ten minutes",
    description: "Make the first ten minutes count: a welcome checklist, an in-app tour and an activation metric everyone reads.",
    target: "2026-11-30",
    health: "onTrack",
    also: ["m4"],
  },
  m3: {
    theme: "Product",
    summary: "The app on iOS and Android, offline first",
    description: "React Native app for the people in the field: receipts, the dashboard offline, single sign-on.",
    target: "2026-10-12",
    health: "onTrack",
    also: ["m1"],
  },
  m4: {
    theme: "Product",
    summary: "One set of tokens and components for every screen",
    description: "Tokens, components and their guidelines, shared by the web and the mobile app.",
    target: "2027-01-31",
    health: "onTrack",
    also: [],
  },
  m5: {
    theme: "Platform",
    summary: "Dashboards, alerts and backups we can trust",
    description: "Grafana and Loki, alerts on what matters, backups tested every month.",
    target: "2026-12-01",
    health: "offTrack",
    also: [],
  },
  m6: {
    theme: "Product",
    summary: "Answers before the questions reach support",
    description: "A help center written with the support team, linked from every screen.",
    target: "2027-03-01",
    health: "onTrack",
    also: ["m2"],
  },
};
const BLK: Record<string, Record<number, string>> = {
  m1: {
    5: "No access to the staging database",
    6: "Access to the staging database still blocked",
    7: "Access to the staging database still pending with IT",
  },
  m2: { 0: "Not enough permissions to create a CRM report", 7: "CRM API export capped at 2,000 rows" },
  m4: {
    2: "The icon set we picked requires a paid licence",
    3: "Icon set licence still not ordered",
  },
  m5: { 1: "CI runners saturated on Monday mornings", 6: "CI runners saturated during deployments" },
};

const MOOD_HIST = [
  [0, 1, 2, 2, 0],
  [0, 0, 1, 3, 1],
  [0, 1, 1, 2, 1],
  [1, 1, 2, 1, 0],
  [0, 0, 2, 2, 1],
];
// How useful each session was, rated at its wrap-up: better once the round got shorter
const RATING_HIST = [
  [0, 1, 2, 2, 1],
  [0, 1, 2, 2, 1],
  [0, 0, 2, 3, 1],
  [0, 0, 1, 4, 1],
  [0, 0, 1, 3, 2],
  [0, 0, 1, 2, 3],
  [0, 0, 0, 3, 3],
  [0, 0, 1, 2, 3],
];
const avgOf = (c: number[]) => c.reduce((a, n, i) => a + n * (i + 1), 0) / c.reduce((a, b) => a + b, 0);
const TEAM_NAME = "Product team (demo)";
const CATEGORIES = ["Engineering", "Product", "Design"];

/** Modules the demo meeting leaves off */
const SHOWCASE_OFF = new Set(["rotation", "async", "github"]);

async function main() {
  const force = process.argv.includes("--force");
  const existing = await prisma.workspace.findUnique({ where: { slug: SLUG } });
  if (existing && !force) {
    console.log("The demo workspace already exists: nothing changed. Run again with --force to recreate it.");
    return;
  }
  if (existing) await prisma.workspace.delete({ where: { id: existing.id } });
  // Accounts a previous demo gave to the team (the pictures of the site sign one in): they start over too
  if (force) await prisma.user.deleteMany({ where: { email: { in: TEAM.map(([, name]) => mail(name)) } } });

  // Account of the host (the first account of an empty instance also administers it)
  let user = await prisma.user.findUnique({ where: { email: HOST_EMAIL } });
  if (!user) {
    const first = (await prisma.user.count()) === 0;
    user = await prisma.user.create({
      data: { id: crypto.randomUUID(), email: HOST_EMAIL, name: "Alex Host", emailVerified: true, instanceRole: first ? "admin" : "user" },
    });
    await prisma.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword(HOST_PASSWORD),
      },
    });
  }

  // In Paris: its meetings skip the French public holidays
  const workspace = await prisma.workspace.create({
    data: { slug: SLUG, name: "Demo", locale: "en", timezone: "Europe/Paris", settings: { holidays: "FR" } },
  });
  const workspaceId = workspace.id;
  const categories = Object.fromEntries(
    await Promise.all(
      CATEGORIES.map(async (name, position) => [
        name,
        (await prisma.jobCategory.create({ data: { workspaceId, name, position, color: position } })).id,
      ]),
    ),
  );
  const hostPerson = await prisma.person.create({
    data: { workspaceId, userId: user.id, email: HOST_EMAIL, firstName: "Alex", lastName: "Host", color: 5 },
  });
  await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, personId: hostPerson.id, role: "owner" } });

  const ids: Record<string, string> = {};
  for (const [i, [key, name, jobCategory]] of TEAM.entries()) {
    const [firstName = name, ...rest] = name.split(" ");
    const person = await prisma.person.create({
      data: { workspaceId, email: mail(name), firstName, lastName: rest.join(" "), jobCategoryId: categories[jobCategory], color: i % 6 },
    });
    ids[key] = person.id;
  }
  // The team has the faces of the site and the sign-in pages (drawn as SVG, stored as WebP like an uploaded photo)
  const faces = new Map(roundTableFaces().map((f) => [f.name, f.src]));
  for (const [key, name] of TEAM) {
    const src = faces.get(name.split(" ")[0]!);
    if (!src) continue;
    const svg = Buffer.from(decodeURIComponent(src.slice(src.indexOf(",") + 1)));
    const data = await sharp(svg, { density: 300 }).resize(256, 256).webp({ quality: 88 }).toBuffer();
    await prisma.personAvatar.create({ data: { personId: ids[key]!, workspaceId, data, type: "image/webp" } });
  }
  // Two birthdays coming up, for the home page
  const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(5, 10);
  await prisma.person.update({ where: { id: ids.m2! }, data: { birthday: soon(3) } });
  await prisma.person.update({ where: { id: ids.m4! }, data: { birthday: soon(17) } });

  // The portfolio of the workspace
  const themes: Record<string, string> = {};
  for (const [position, name] of ["Product", "Platform"].entries())
    themes[name] = (await prisma.projectTheme.create({ data: { workspaceId, name, color: position + 1, position } })).id;
  const projectIds: Record<string, string> = {};
  for (const [i, [key, , , name]] of TEAM.entries()) {
    const p = PROJECTS[key]!;
    const project = await prisma.project.create({
      data: {
        workspaceId,
        slug: name.toLowerCase().replace(/[^a-z]+/g, "-"),
        name,
        summary: p.summary,
        description: p.description,
        themeId: themes[p.theme],
        health: p.health,
        leadId: ids[key],
        startDate: "2026-06-01",
        targetDate: p.target,
        color: i % 6,
        position: i,
      },
    });
    projectIds[key] = project.id;
    await prisma.projectMember.createMany({
      data: [key, ...p.also].map((k) => ({ workspaceId, projectId: project.id, personId: ids[k]! })),
    });
    // Its logo, as a team would upload one: drawn as SVG, stored as WebP
    const logo = await sharp(Buffer.from(projectLogo(i)), { density: 300 })
      .resize(256, 256)
      .webp({ quality: 90 })
      .toBuffer();
    await prisma.projectLogo.create({ data: { projectId: project.id, workspaceId, data: logo, type: "image/webp" } });
  }

  const meeting = await prisma.meeting.create({
    data: {
      workspaceId,
      name: TEAM_NAME,
      icon: "🚀",
      videoUrl: "https://meet.example.com/product-team",
      announcements: ["Welcome to Hugo, who joins the design team", "The mobile app release is planned for October 12"],
      // The irritants come first, right after the intro: dealt with there, not in the middle of someone's turn
      agenda: [
        { id: "intro", type: "intro" },
        { id: "irritants", type: "slide", kind: "irritants", title: "Irritants" },
        { id: "round", type: "round" },
        { id: "topics", type: "topics" },
      ],
      createdById: user.id,
    },
  });
  const meetingId = meeting.id;
  // Every Monday at 14:00 (Paris), as the archived sessions below
  const rule = await prisma.scheduleRule.create({
    data: { workspaceId, meetingId, freq: "weekly", interval: 1, byDay: [1], startDate: "2025-01-06", time: "14:00", durationMin: 30 },
  });
  const planned = (date: string) => ({
    time: "14:00",
    durationMin: 30,
    occurrenceKey: `${rule.id}:${date}`,
    startsAt: new Date(zonedInstant(date, "14:00", "Europe/Paris")),
  });
  // The demo shows what Ronde can do: the facilitation modules and the formats on (a new meeting starts with
  // fewer), so every block of the agenda can be added; the extra integrations off; the icebreaker gets the demo
  // question bank
  await prisma.moduleInstallation.createMany({
    data: MODULES.map((mod) => ({
      workspaceId,
      meetingId,
      moduleId: mod.id,
      enabled: !SHOWCASE_OFF.has(mod.id),
      config: (mod.id === "icebreaker"
        ? {
            bank: [
              "Your small win of the week?",
              "A tool, a tip or a read you discovered recently?",
              "What made you smile at work this week?",
              "A task you can't wait to tackle?",
              "A skill you'd like to learn this quarter?",
              "The weirdest bug you've ever come across?",
            ],
          }
        : mod.config.defaults) as object,
    })),
  });
  await prisma.section.createMany({
    data: DEFAULT_SECTIONS.map((s, position) => ({
      workspaceId,
      meetingId,
      key: s.key,
      label: s.label,
      role: s.role,
      input: s.input,
      position,
    })),
  });
  await prisma.meetingParticipant.createMany({
    data: [
      { workspaceId, meetingId, personId: hostPerson.id, role: "host" as const, position: 0, active: false },
      ...TEAM.map(([key], i) => ({ workspaceId, meetingId, personId: ids[key]!, role: "participant" as const, position: i + 1 })),
    ],
  });
  // The meeting follows the whole portfolio
  await prisma.meetingProject.createMany({
    data: TEAM.map(([key], position) => ({ workspaceId, meetingId, projectId: projectIds[key]!, position })),
  });
  /** Item rows of a check-in; an achievement written like an item planned last time reports on it */
  const itemRows = (
    personId: string,
    fields: Omit<RecordCheckIn, "byProject">,
    sessionId: string | null,
    plans: Map<string, string>,
    projectId: string | null = null,
  ) => {
    const items = itemsFromCheckIn(fields, DEFAULT_SECTIONS);
    return DEFAULT_SECTIONS.flatMap((def) =>
      (items[def.key] ?? []).map((text, position) => ({
        id: crypto.randomUUID(),
        workspaceId,
        meetingId,
        personId,
        projectId,
        sessionId,
        sectionKey: def.key,
        role: def.role,
        position,
        text,
        sourceItemId: def.role === "achievement" ? (plans.get(`${personId}:${text}`) ?? null) : null,
      })),
    );
  };
  // Plan items of the previous session: "<personId>:<text>" → item id
  let plans = new Map<string, string>();

  // 8 archived sessions, one Monday a week before the current one
  const current = nextMonday();
  const dates: string[] = [];
  for (let d = current, k = 0; k < 8; k++) {
    const x = new Date(d + "T12:00:00");
    x.setDate(x.getDate() - 7);
    d = x.toISOString().slice(0, 10);
    dates.unshift(d);
  }
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const five = ["m1", "m2", "m3", "m4", "m5"];
  for (const [w, date] of dates.entries()) {
    const sessionId = crypto.randomUUID();
    const rows: ReturnType<typeof itemRows> = [];
    const spent: Record<string, number> = { intro: 150000 + Math.round(rnd() * 70000), misc: 170000 + Math.round(rnd() * 260000) };
    let total = spent.intro! + spent.misc!;
    for (const k of five) {
      const start = COUNTS[k]!.slice(0, w).reduce((a, b) => a + b, 0);
      const n = COUNTS[k]![w]!;
      const next = w < dates.length - 1 ? POOL[k]!.slice(start + n, start + n + Math.max(1, COUNTS[k]![w + 1]!)) : CURRENT[k]!.done;
      rows.push(
        ...itemRows(
          ids[k]!,
          { done: POOL[k]!.slice(start, start + n), next, blockers: BLK[k]?.[w] ? [BLK[k]![w]!] : [], other: [] },
          sessionId,
          plans,
          projectIds[k]!,
        ),
      );
      spent[ids[k]!] = Math.round(100000 + rnd() * 55000 + (k === "m5" ? 38000 : 0));
      total += spent[ids[k]!]!;
    }
    const startedAt = Date.parse(date + "T14:00:00");
    // Thanks given during the last sessions, for the profiles
    const thanks: Record<number, [string, string, string][]> = {
      4: [["m3", "m5", "The on-call runbook is a life saver"]],
      5: [
        ["m5", "m4", "Beautiful new icons, the app feels fresh"],
        ["m1", "m3", "Thanks for pairing on the flaky tests"],
      ],
      6: [["m2", "m1", "For unblocking the billing export in a day"]],
      7: [
        ["m4", "m1", "Your review of the API docs saved us a week"],
        ["m1", "m2", "Great demo to the account owners"],
      ],
    };
    // Questions and raised hands of the room, kept in the record (the stats count them)
    const asked: Record<number, ["hand" | "question", string, string | null, string][]> = {
      2: [["question", "m3", "m1", "When does the payments endpoint reach staging?"]],
      3: [["hand", "m4", null, ""]],
      4: [["question", "m2", "m5", "Can the alerts go to the support channel too?"]],
      5: [
        ["question", "m1", "m2", "Which customers need the CRM export first?"],
        ["hand", "m6", null, ""],
      ],
      6: [["question", "m5", "m3", "Does the offline mode need a feature flag?"]],
      7: [
        ["question", "m4", "m1", "Can we help with the IT ticket?"],
        ["hand", "m3", null, ""],
      ],
    };
    const record: RecordV1 = {
      v: 1,
      date,
      teamName: TEAM_NAME,
      hostLabel: "",
      startedAt,
      endedAt: startedAt + total,
      durationMs: total,
      spent,
      participants: five.map((k) => ({
        id: ids[k]!,
        name: TEAM.find((t) => t[0] === k)![1],
        jobCategory: TEAM.find((t) => t[0] === k)![2],
      })),
      absent: [],
      sections: DEFAULT_SECTIONS,
      checkIns: Object.fromEntries(
        five.map((k) => [
          ids[k]!,
          {
            items: rows
              .filter((r) => r.personId === ids[k])
              .map((r) => ({
                id: r.id,
                section: r.sectionKey,
                text: r.text,
                sourceItemId: r.sourceItemId,
                projectId: r.projectId,
                with: [],
              })),
          },
        ]),
      ),
      notes:
        w === 7
          ? { [ids.m1!]: "Decision: we escalate the IT ticket if there is no answer by Thursday." }
          : w === 5
            ? { [ids.m2!]: "Decision: the CRM export moves to a nightly warehouse sync." }
            : w === 3
              ? { [ids.m4!]: "Decision: the design system ships its own release notes." }
              : {},
      interactions: (asked[w] ?? []).map(([type, by, target, text]) => ({
        type,
        byId: ids[by]!,
        targetId: target ? ids[target]! : null,
        text,
        stepKey: target ? ids[target]! : "qa",
        resolved: true,
      })),
      topics: [],
      actions: [],
      names: Object.fromEntries(TEAM.map(([k, n]) => [ids[k]!, n])),
      icebreaker: null,
      kudos: (thanks[w] ?? []).map(([from, to, text]) => ({ fromId: ids[from]!, toId: ids[to]!, text })),
      mood: w >= 3 ? { counts: MOOD_HIST[w - 3]!, avg: avgOf(MOOD_HIST[w - 3]!) } : null,
      rating: RATING_HIST[w] ? { counts: RATING_HIST[w]!, avg: avgOf(RATING_HIST[w]!) } : null,
      comments: [],
      nextDate: null,
      omit: [],
      agenda: [],
      retro: null,
      poker: [],
      parking: [],
      polls: [],
      slides: [],
      // Each person presented their project in their turn; the Billing API slipped when staging stayed closed
      projects: five.map((k) => ({
        id: projectIds[k]!,
        name: TEAM.find((t) => t[0] === k)![3],
        theme: PROJECTS[k]!.theme,
        status: "active",
        health: k === "m1" && w >= 5 ? "atRisk" : k === "m5" && w >= 6 ? "offTrack" : "onTrack",
        headline: "",
        speakers: [],
        presented: false,
      })),
    };
    await prisma.session.create({
      data: {
        id: sessionId,
        workspaceId,
        meetingId,
        date,
        ...planned(date),
        status: "archived",
        record: record as unknown as Prisma.InputJsonValue,
        archivedAt: new Date(startedAt + total),
        startedAt: new Date(startedAt),
        endedAt: new Date(startedAt + total),
      },
    });
    for (const [from, to, text] of thanks[w] ?? [])
      await prisma.kudo.create({ data: { workspaceId, sessionId, fromId: ids[from]!, toId: ids[to]!, text } });
    // The last session was recorded: its transcript, turn by turn
    if (w === 7) {
      const said: [string | null, string, string][] = [
        [null, "intro", "Good morning everyone, let's start with the round table."],
        ["m1", "m1", "The payments v2 endpoint is live. I am still waiting for the staging database access, IT has not answered."],
        ["m2", "m2", "The pricing page experiment is done; the CRM export is capped at two thousand rows, we need another way."],
        ["m4", "m4", "New spacing scale this week, the component guidelines come next."],
      ];
      await prisma.transcriptSegment.createMany({
        data: said.map(([who, stepKey, text], k) => ({
          workspaceId,
          sessionId,
          at: new Date(startedAt + k * 150_000),
          durationMs: 20_000,
          text,
          stepKey: who ? ids[who]! : stepKey,
          speakerId: who ? ids[who]! : null,
        })),
      });
    }
    await prisma.checkInItem.createMany({ data: rows });
    plans = new Map(rows.filter((r) => r.role === "plan").map((r) => [`${r.personId}:${r.text}`, r.id]));
  }
  // Current check-ins: their achievements report on what was planned at the last session
  const current_: Record<string, string> = {};
  for (const [key] of TEAM) {
    const { other, ...work } = CURRENT[key]!;
    await prisma.checkIn.create({ data: { workspaceId, meetingId, personId: ids[key]! } });
    // News of the person in their own tab, the work in the tab of their project
    const rows = [
      ...itemRows(ids[key]!, { done: [], next: [], blockers: [], other }, null, plans),
      ...itemRows(ids[key]!, { ...work, other: [] }, null, plans, projectIds[key]!),
    ];
    await prisma.checkInItem.createMany({ data: rows });
    for (const r of rows) current_[`${key}:${r.sectionKey}:${r.text}`] = r.id;
  }

  // Sofia worked on Emma's pagination too: she joined the line, her face shows on it
  await prisma.checkInItemContributor.create({
    data: { workspaceId, itemId: current_["m1:done:Pagination of the /customers endpoint"]!, personId: ids.m5! },
  });

  // Sheets written for the coming session by two project leads
  await prisma.projectUpdate.createMany({
    data: [
      {
        workspaceId,
        meetingId,
        projectId: projectIds.m1!,
        health: "atRisk" as const,
        headline: "The cache on /invoices is ready, but **staging is still closed**: the December date holds only if IT answers this week.",
        updatedById: ids.m1!,
        headlineById: ids.m1!,
      },
      {
        workspaceId,
        meetingId,
        projectId: projectIds.m3!,
        health: "onTrack" as const,
        headline: "Single sign-on works on staging; the release of October 12 holds.",
        updatedById: ids.m3!,
        headlineById: ids.m3!,
      },
    ],
  });

  const session = await prisma.session.create({
    data: {
      workspaceId,
      meetingId,
      date: current,
      ...planned(current),
      order: TEAM.map(([k]) => ids[k]!),
      icebreaker: "Your small win of the week?",
    },
  });
  const sessionId = session.id;
  // What the team raised before the meeting, on the irritants slide
  await prisma.slideItem.createMany({
    data: [
      { workspaceId, sessionId, blockId: "irritants", authorId: ids.m3!, text: "Staging is down every Monday morning" },
      { workspaceId, sessionId, blockId: "irritants", authorId: ids.m2!, text: "The same ticket is updated in three tools" },
      { workspaceId, sessionId, blockId: "irritants", authorId: ids.m4!, text: "Design reviews land after the sprint has started" },
    ],
  });
  await prisma.icebreakerAnswer.createMany({
    data: [
      { workspaceId, sessionId, byId: ids.m2!, text: "Account owners approved the new screen on the first try" },
      { workspaceId, sessionId, byId: ids.m5!, text: "Zero alerts this weekend" },
    ],
  });
  await prisma.action.createMany({
    data: [
      {
        workspaceId,
        meetingId,
        text: "Get access to the staging database (follow up with IT)",
        ownerId: ids.m1!,
        status: "doing",
        originDate: dates[5],
        originText: "No access to the staging database",
      },
      {
        workspaceId,
        meetingId,
        text: "Work around the CRM export cap (paginated export or warehouse sync)",
        ownerId: ids.m2!,
        originDate: dates[7],
        originText: "CRM API export capped at 2,000 rows",
      },
      // The demo account's own follow-up, for the actions page
      { workspaceId, meetingId, text: "Book a room for the quarterly review", ownerId: hostPerson.id, originDate: dates[4] },
      {
        workspaceId,
        meetingId,
        text: "Share the onboarding checklist with the two new hires",
        ownerId: hostPerson.id,
        status: "doing",
        originDate: dates[7],
      },
      {
        workspaceId,
        meetingId,
        text: "Send the sprint summary to the account owners",
        ownerId: hostPerson.id,
        status: "done",
        originDate: dates[6],
        doneAt: new Date(Date.now() - 2 * 86_400_000),
      },
    ],
  });
  // Each action was decided at its session: it is that old, so the time taken to close it means something
  await prisma.$executeRaw`UPDATE "Action" SET "createdAt" = ("originDate" || 'T15:00:00Z')::timestamptz
    WHERE "meetingId" = ${meetingId} AND "originDate" IS NOT NULL`;
  // The bell of the demo account
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  await prisma.inboxItem.createMany({
    data: [
      {
        workspaceId,
        personId: hostPerson.id,
        kind: "kudo.received",
        actorId: ids.m1!,
        meetingId,
        data: { text: "Thanks for chasing IT about the staging access" },
        href: `/people/${hostPerson.id}`,
        createdAt: ago(25),
      },
      {
        workspaceId,
        personId: hostPerson.id,
        kind: "action.assigned",
        actorId: ids.m2!,
        meetingId,
        data: { text: "Share the onboarding checklist with the two new hires" },
        href: "/actions",
        createdAt: ago(180),
      },
      {
        workspaceId,
        personId: hostPerson.id,
        kind: "minutes.published",
        actorId: null,
        meetingId,
        href: `/m/${meetingId}/history`,
        createdAt: ago(60 * 24 * 2),
        readAt: ago(60 * 24),
      },
    ],
  });
  await prisma.mood.createMany({
    data: [
      { workspaceId, sessionId, personId: ids.m2!, value: 4 },
      { workspaceId, sessionId, personId: ids.m5!, value: 5 },
      { workspaceId, sessionId, personId: ids.m1!, value: 2 },
    ],
  });
  await prisma.checkInComment.createMany({
    data: [
      {
        workspaceId,
        sessionId,
        ownerId: ids.m2!,
        itemId: current_["m2:done:Approval screen for account owners"]!,
        byId: ids.m3!,
        text: "",
      },
      {
        workspaceId,
        sessionId,
        ownerId: ids.m2!,
        itemId: current_["m2:done:Approval screen for account owners"]!,
        byId: ids.m1!,
        text: "",
      },
      {
        workspaceId,
        sessionId,
        ownerId: ids.m1!,
        itemId: current_[`m1:blockers:${CURRENT.m1!.blockers[0]!}`]!,
        byId: ids.m5!,
        text: "I know someone in IT, I can follow up.",
      },
    ],
  });
  const t1 = await prisma.topic.create({ data: { workspaceId, meetingId, text: "Naming convention for feature flags", byId: ids.m2 } });
  const t2 = await prisma.topic.create({
    data: { workspaceId, meetingId, text: "Who is on call during the autumn holidays?", byId: ids.m5 },
  });
  await prisma.topicVote.createMany({
    data: [
      { workspaceId, topicId: t2.id, personId: ids.m1! },
      { workspaceId, topicId: t2.id, personId: ids.m3! },
      { workspaceId, topicId: t1.id, personId: ids.m4! },
    ],
  });
  console.log(
    `Demo data created: workspace /w/${SLUG}, ${TEAM.length} people, ${dates.length} archived sessions, session of ${current} ready.\n` +
      `Sign in as ${HOST_EMAIL} / ${HOST_PASSWORD}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
