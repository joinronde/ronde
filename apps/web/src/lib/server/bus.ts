import "server-only";
import { EventEmitter } from "node:events";
import type { BusEvent } from "@ronde/module-sdk";
import pg from "pg";
import { prisma } from "./db";
import { env } from "./env";

// Real-time broadcast of changes, per meeting.
// Each change sends a PostgreSQL NOTIFY carrying the meeting id: every instance of the app (replicas
// included) receives it and relays it to the browsers following that meeting.

export type { BusEvent } from "@ronde/module-sdk";

/** What goes through PostgreSQL: the event and the meeting it is about ("*" for every meeting) */
type Envelope = BusEvent & { m: string };

const CHANNEL = "ronde";
/** Regular check of the LISTEN connection */
const HEARTBEAT_MS = 20_000;
/** Without an answer within this delay, the connection is considered dead */
const HEARTBEAT_TIMEOUT_MS = 5_000;

interface BusState {
  emitter: EventEmitter;
  // Each envelope is emitted under its meeting id, and every subscriber listens to one meeting
  listening: Promise<void> | null;
  client: pg.Client | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  /** Number of LISTEN connections opened since start-up */
  connects: number;
}
const g = globalThis as unknown as { __rondeBus?: BusState };
const bus: BusState = (g.__rondeBus ??= {
  emitter: new EventEmitter().setMaxListeners(0),
  listening: null,
  client: null,
  heartbeat: null,
  connects: 0,
});

/**
 * LISTEN connection lost: close it and open another one.
 * Some overlay networks (Docker Swarm IPVS, ~15 min) silently drop an idle TCP connection: without a
 * heartbeat, the instance would receive no notification at all until it restarts.
 */
function reconnect(client: pg.Client, reason: string) {
  if (bus.client !== client) return;
  console.error("[bus] LISTEN connection lost, reconnecting:", reason);
  bus.client = null;
  bus.listening = null;
  if (bus.heartbeat) clearInterval(bus.heartbeat);
  bus.heartbeat = null;
  client.removeAllListeners("notification");
  void client.end().catch(() => undefined);
  setTimeout(() => void listen().catch(() => undefined), 2000);
}

function listen(): Promise<void> {
  if (bus.listening) return bus.listening;
  const client = new pg.Client({ connectionString: env.databaseUrl(), keepAlive: true, keepAliveInitialDelayMillis: 10_000 });
  bus.client = client;
  bus.listening = (async () => {
    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const { m, ...event } = JSON.parse(msg.payload) as Envelope;
        if (m === "*") for (const name of bus.emitter.eventNames()) bus.emitter.emit(name, event);
        else bus.emitter.emit(m, event);
      } catch {
        /* unreadable message ignored */
      }
    });
    client.on("error", (e) => reconnect(client, e.message));
    client.on("end", () => reconnect(client, "connection closed"));
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    bus.heartbeat = setInterval(() => {
      const timeout = setTimeout(() => reconnect(client, "no answer to the heartbeat"), HEARTBEAT_TIMEOUT_MS);
      client
        .query("SELECT 1")
        .then(() => clearTimeout(timeout))
        .catch((e: Error) => {
          clearTimeout(timeout);
          reconnect(client, e.message);
        });
    }, HEARTBEAT_MS);
    bus.heartbeat.unref?.();
    // Notifications may have been lost during the outage: browsers reload the state
    if (bus.connects++ > 0) for (const name of bus.emitter.eventNames()) bus.emitter.emit(name, { kind: "state" } satisfies BusEvent);
  })().catch((e) => {
    console.error("[bus] cannot listen to notifications", e);
    if (bus.client === client) {
      bus.client = null;
      bus.listening = null;
    }
    void client.end().catch(() => undefined);
    // Database temporarily unreachable: retry as long as browsers are waiting for events
    if (bus.emitter.eventNames().length > 0) setTimeout(() => void listen().catch(() => undefined), 5000);
    throw e;
  });
  return bus.listening;
}

/** Tell every browser following a meeting ("*": every meeting, e.g. a profile photo changed) */
export async function publish(meetingId: string, event: BusEvent): Promise<void> {
  const envelope: Envelope = { ...event, m: meetingId };
  await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(envelope)})`;
}

export async function subscribe(meetingId: string, fn: (e: BusEvent) => void): Promise<() => void> {
  bus.emitter.on(meetingId, fn);
  try {
    await listen();
  } catch (e) {
    bus.emitter.off(meetingId, fn);
    throw e;
  }
  return () => bus.emitter.off(meetingId, fn);
}
