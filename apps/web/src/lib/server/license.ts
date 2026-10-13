import "server-only";
import { type Prisma, prisma } from "@ronde/db";
import { EDITIONS, type Edition, type FeatureId, hasFeature } from "@ronde/editions";
import { LICENSE_PUBLIC_KEYS } from "@ronde/editions/keys";
import { checkLicense, type LicenseState, readableEdition, usableEdition } from "@ronde/editions/license";
import { instanceSeats } from "./seats";

// License of a self-hosted instance: RONDE_LICENSE, otherwise the key saved on the administration page.
// Checked offline; read again every minute, so a key saved on one replica reaches the others.

const TTL_MS = 60_000;

/** Signing keys: Ronde's; tests add their own throwaway key (never in a production build) */
function licenseKeys(): Record<string, string> {
  if (process.env.NODE_ENV !== "test" || !process.env.RONDE_LICENSE_TEST_KEYS) return LICENSE_PUBLIC_KEYS;
  return { ...LICENSE_PUBLIC_KEYS, ...(JSON.parse(process.env.RONDE_LICENSE_TEST_KEYS) as Record<string, string>) };
}
let current: { at: number; key: string; state: LicenseState } | null = null;

/** Where the key comes from: the environment wins (infrastructure as code), then the administration page */
export const licenseFromEnv = () => !!process.env.RONDE_LICENSE?.trim();

async function readKey(): Promise<string> {
  if (licenseFromEnv()) return process.env.RONDE_LICENSE!.trim();
  const row = await prisma.instanceSetting.findUnique({ where: { key: "license" } });
  return typeof row?.value === "string" ? row.value : "";
}

/** The license, checked again when the last check is more than a minute old */
export async function loadLicense(force = false): Promise<LicenseState> {
  if (!force && current && Date.now() - current.at < TTL_MS) return current.state;
  const key = await readKey();
  const state = checkLicense(key, { keys: licenseKeys() });
  current = { at: Date.now(), key, state };
  return state;
}

/** Last checked license (synchronous): Community until the first check */
export const licenseState = (): LicenseState => current?.state ?? { status: "none" };

/** Edition whose features this instance can use */
export const edition = (): Edition => usableEdition(licenseState());

/** The cloud bills each workspace on its own plan; a self-hosted instance has one license for all */
export const isCloud = () => process.env.RONDE_CLOUD === "1";

/** What a feature check needs to know about the workspace: its plan in the cloud */
export type PlanScope = { plan?: string | null } | null | undefined;

/**
 * Edition a workspace can use: its plan in the cloud (Community when unknown), the license otherwise.
 * Checks without a workspace (instance pages, jobs across workspaces) get the instance's edition.
 */
export function editionOf(ws?: PlanScope): Edition {
  if (!isCloud()) return edition();
  const plan = ws?.plan;
  return (EDITIONS as readonly string[]).includes(plan ?? "") ? (plan as Edition) : "community";
}

/** Edition whose data a workspace can still read: its plan in the cloud, the license (expired too) otherwise */
export function readEditionOf(ws?: PlanScope): Edition {
  return isCloud() ? editionOf(ws) : readEdition();
}

/** Whether a workspace may use a feature */
export const featureOn = (feature: FeatureId, ws?: PlanScope) => hasFeature(editionOf(ws), feature);

/** Edition whose data can still be read (an expired license keeps its data readable) */
export const readEdition = (): Edition => readableEdition(licenseState());

/** Saves a key from the administration page; an empty key removes it. Returns the new state. */
export async function saveLicense(key: string): Promise<LicenseState> {
  const clean = key.trim();
  const state = checkLicense(clean, { keys: licenseKeys() });
  if (clean && state.status === "invalid") return state;
  if (clean)
    await prisma.instanceSetting.upsert({ where: { key: "license" }, create: { key: "license", value: clean }, update: { value: clean } });
  else await prisma.instanceSetting.deleteMany({ where: { key: "license" } });
  return loadLicense(true);
}

/** People who count against the seats: those who took part in a meeting in the last 30 days, as in the cloud */
export const usedSeats = (now = Date.now()) => instanceSeats(now);

/** The highest seat count of the license in place, since it was saved: what its renewal settles */
export interface SeatPeak {
  licenseId: string;
  peak: number;
  /** When the peak was reached, and since when it is followed (ISO dates) */
  peakAt: string;
  since: string;
}

const PEAK_KEY = "licenseSeatPeak";

function readPeak(value: unknown): SeatPeak | null {
  const v = value as Partial<SeatPeak> | null;
  return v && typeof v.licenseId === "string" && typeof v.peak === "number" && typeof v.peakAt === "string" && typeof v.since === "string"
    ? (v as SeatPeak)
    : null;
}

/** The peak followed for the license in place; null without a license or before its first count */
export async function seatPeak(): Promise<SeatPeak | null> {
  const state = await loadLicense();
  if (!("license" in state)) return null;
  const row = await prisma.instanceSetting.findUnique({ where: { key: PEAK_KEY } });
  const peak = readPeak(row?.value);
  return peak?.licenseId === state.license.id ? peak : null;
}

/**
 * Counts the seats now and keeps the highest count of the license in place (a new license starts over). Run
 * every day by a job, and when an administrator opens the instance page; never in the cloud.
 */
export async function recordSeatPeak(now = new Date()): Promise<SeatPeak | null> {
  if (isCloud()) return null;
  const state = await loadLicense();
  if (!("license" in state)) return null;
  const used = await usedSeats(now.getTime());
  const row = await prisma.instanceSetting.findUnique({ where: { key: PEAK_KEY } });
  const old = readPeak(row?.value);
  const at = now.toISOString();
  const next: SeatPeak =
    old?.licenseId !== state.license.id
      ? { licenseId: state.license.id, peak: used, peakAt: at, since: at }
      : used > old.peak
        ? { ...old, peak: used, peakAt: at }
        : old;
  if (next !== old) {
    const value = next as unknown as Prisma.InputJsonValue;
    await prisma.instanceSetting.upsert({ where: { key: PEAK_KEY }, create: { key: PEAK_KEY, value }, update: { value } });
  }
  return next;
}
