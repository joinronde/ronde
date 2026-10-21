import "server-only";
import { prisma, refreshPlans, scoped } from "@ronde/db";
import { defineJob, startJobs } from "@ronde/jobs";
import { streamAudit } from "./audit";
import { syncSeats } from "./billing";
import { syncCalendars } from "./calendars";
import { env } from "./env";
import { purgeFeedback } from "./feedback";
import { checkInbound } from "./inbound";
import { isCloud, recordSeatPeak } from "./license";
import { closeAsyncSessions } from "./meeting/async";
import { remindDrafts } from "./meeting/drafts";
import { resyncSession } from "./meeting/schedule";
import { closeStaleSessions } from "./meeting/stale";
import { deliver } from "./notify/dispatch";
import { syncProjects } from "./project-import";
import { pushInbox } from "./push";
import { checkDaily, checkReminders } from "./reminders";
import { checkReports } from "./reports";
import { purgeExpired } from "./retention";
import { syncTickets } from "./trackers";
import { processPendingChunks } from "./transcripts";
import { sendWeeklySummaries } from "./weekly";

// Background work of the app. Each recurring job runs once per tick, whatever the number of replicas.

/** Every meeting with a date ahead gets its next session prepared (after the last one was archived late…) */
export async function prepareSessions(): Promise<void> {
  const meetings = await prisma.meeting.findMany({
    where: {
      archivedAt: null,
      workspace: { deletedAt: null, suspendedAt: null },
      rules: { some: {} },
      sessions: { none: { status: "current" } },
    },
    include: { workspace: { select: { timezone: true } } },
  });
  for (const m of meetings) {
    try {
      await scoped(prisma, m.workspaceId).$transaction((tx) => resyncSession(tx, m, m.workspace));
    } catch (e) {
      console.error(`[jobs] preparing the session of meeting ${m.id} failed`, e);
    }
  }
}

export const JOBS = [
  defineJob({ name: "reminders.check", cron: "* * * * *", policy: "singleton", retryLimit: 0, handler: () => checkReminders() }),
  defineJob({ name: "notify.daily", cron: "3 * * * *", policy: "singleton", retryLimit: 0, handler: () => checkDaily() }),
  // Monday's summary of each person's week (from 08:00 in each workspace's time zone)
  defineJob({ name: "weekly.send", cron: "29 * * * *", policy: "singleton", retryLimit: 0, handler: () => sendWeeklySummaries() }),
  // What lands in the bell, on the devices with push notifications on
  defineJob({ name: "push.inbox", cron: "* * * * *", policy: "singleton", retryLimit: 0, handler: () => pushInbox() }),
  // Check-ins written in a reply to the reminder (INBOUND_IMAP_URL)
  defineJob({ name: "inbound.check", cron: "* * * * *", policy: "singleton", retryLimit: 0, handler: () => checkInbound() }),
  // A failed delivery is retried a few times, a minute apart at first
  defineJob<{ deliveryId: string }>({
    name: "notify.deliver",
    retryLimit: 4,
    retryDelay: 60,
    handler: ({ deliveryId }) => deliver(deliveryId),
  }),
  // Async meetings: their sessions close at the planned time, then the digest goes out
  defineJob({ name: "sessions.closeAsync", cron: "*/5 * * * *", policy: "singleton", retryLimit: 0, handler: () => closeAsyncSessions() }),
  // Live sessions forgotten open (RONDE_AUTO_CLOSE_HOURS, 12 h by default): archived, their minutes as drafts
  defineJob({ name: "sessions.closeStale", cron: "*/10 * * * *", policy: "singleton", retryLimit: 0, handler: () => closeStaleSessions() }),
  // Minutes left as drafts (RONDE_DRAFT_REMIND_DAYS, 2 days by default): their hosts are reminded once
  defineJob({ name: "minutes.remindDrafts", cron: "41 * * * *", policy: "singleton", retryLimit: 0, handler: () => remindDrafts() }),
  // Audit entries sent to the workspace's SIEM, retried a few times
  defineJob<{ workspaceId: string; auditId: string }>({
    name: "audit.stream",
    retryLimit: 5,
    retryDelay: 30,
    handler: (d) => streamAudit(d),
  }),
  // Insights by email, at the start of the week or the month (Team)
  defineJob({ name: "reports.send", cron: "11 * * * *", policy: "singleton", retryLimit: 0, handler: () => checkReports() }),
  // Tickets closed in the trackers close their actions
  // Paid seats follow the active people (cloud)
  defineJob({ name: "billing.seats", cron: "17 3 * * *", policy: "singleton", retryLimit: 0, handler: () => syncSeats() }),
  // Plans granted by the Ronde team start and end on their dates (cloud)
  defineJob({
    name: "plans.refresh",
    cron: "23 * * * *",
    policy: "singleton",
    retryLimit: 0,
    handler: async () => (isCloud() ? refreshPlans() : 0),
  }),
  // Pieces of sound left to transcribe (a restart, a failure)
  defineJob({ name: "transcript.process", cron: "* * * * *", policy: "singleton", retryLimit: 0, handler: () => processPendingChunks() }),
  // Sessions written into the calendars, kept up to date
  defineJob({ name: "calendar.sync", cron: "*/15 * * * *", policy: "singleton", retryLimit: 0, handler: () => syncCalendars() }),
  defineJob({ name: "trackers.sync", cron: "*/15 * * * *", policy: "singleton", retryLimit: 0, handler: () => syncTickets() }),
  // Imported projects kept in sync with their tool (Team): their name, status, dates and progress
  defineJob({ name: "projects.sync", cron: "23 * * * *", policy: "singleton", retryLimit: 0, handler: () => syncProjects() }),
  defineJob({ name: "sessions.prepare", cron: "7 * * * *", policy: "singleton", retryLimit: 0, handler: () => prepareSessions() }),
  // Messages of "Send feedback" are kept a year
  defineJob({ name: "feedback.purge", cron: "41 4 * * *", policy: "singleton", retryLimit: 0, handler: () => purgeFeedback() }),
  // What is past its time goes: deleted workspaces after 30 days, old audit entries, deliveries, bell items…
  defineJob({ name: "retention.purge", cron: "53 4 * * *", policy: "singleton", retryLimit: 0, handler: () => purgeExpired() }),
  // A self-hosted license: the highest seat count since it was saved, settled at its renewal
  defineJob({
    name: "license.seats",
    cron: "37 3 * * *",
    policy: "singleton",
    retryLimit: 0,
    handler: async () => (await recordSeatPeak())?.peak ?? 0,
  }),
];

export function startBackgroundJobs() {
  return startJobs({ connectionString: env.databaseUrl(), jobs: JOBS });
}
