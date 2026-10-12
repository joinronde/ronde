// Background jobs on the same PostgreSQL as the app (pg-boss, in its own "pgboss" schema): no Redis.
// A scheduled job runs once per tick whatever the number of replicas; a failing job is retried.
// The Community Edition runs the workers inside the web process; a cloud deployment can run them apart.

import { PgBoss } from "pg-boss";

export interface JobDef<D extends object = object> {
  /** Queue name, e.g. "reminders.check" */
  name: string;
  /** Cron expression for recurring jobs (UTC), e.g. "* * * * *" */
  cron?: string;
  /** Attempts after a failure */
  retryLimit?: number;
  /** Seconds before the first retry, doubled at each attempt */
  retryDelay?: number;
  /** "singleton": a single job of this queue runs at a time (recurring checks) */
  policy?: "standard" | "singleton";
  /** Declared as a method: a job of any data type fits in a list of jobs */
  handler(data: D): Promise<unknown>;
}

export const defineJob = <D extends object>(def: JobDef<D>) => def;

export interface JobRunner {
  /** Queue a job now (e.g. a message to deliver), optionally once per key */
  send: (name: string, data?: object, options?: { singletonKey?: string; startAfter?: Date }) => Promise<string | null>;
  stop: () => Promise<void>;
}

const g = globalThis as unknown as { __rondeJobs?: Promise<JobRunner> };

/**
 * Starts the workers and the recurring schedules, once per process (development reloads and several
 * imports reuse the same runner).
 */
export function startJobs(options: {
  connectionString: string;
  schema?: string;
  jobs: readonly JobDef[];
  log?: (msg: string, e?: unknown) => void;
}) {
  g.__rondeJobs ??= (async () => {
    const log = options.log ?? ((msg, e) => (e ? console.error(msg, e) : console.log(msg)));
    const boss = new PgBoss({
      connectionString: options.connectionString,
      schema: options.schema ?? "pgboss",
      application_name: "ronde-jobs",
    });
    boss.on("error", (e) => log("[jobs] error", e));
    await boss.start();
    for (const job of options.jobs) {
      await boss.createQueue(job.name, {
        policy: job.policy ?? "standard",
        retryLimit: job.retryLimit ?? 2,
        ...(job.retryDelay ? { retryDelay: job.retryDelay, retryBackoff: true } : {}),
      });
      await boss.work<object>(job.name, async (batch) => {
        for (const item of batch) await job.handler(item.data ?? {});
      });
      if (job.cron) await boss.schedule(job.name, job.cron, null, { tz: "UTC" });
      else await boss.unschedule(job.name).catch(() => undefined);
    }
    log(`[jobs] ${options.jobs.length} queue(s) ready`);
    return {
      send: (name, data, opts) => boss.send(name, data ?? null, opts),
      stop: async () => {
        // The jobs running finish (a few seconds at most: the container is given ten to stop), none starts
        await boss.stop({ graceful: true, timeout: 8000 });
        g.__rondeJobs = undefined;
      },
    } satisfies JobRunner;
  })().catch((e) => {
    g.__rondeJobs = undefined;
    throw e;
  });
  return g.__rondeJobs;
}

/** The runner of this process, when jobs were started (null in tests, or with RONDE_JOBS=off) */
export const currentJobs = (): Promise<JobRunner> | null => g.__rondeJobs ?? null;
