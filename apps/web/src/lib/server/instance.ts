import "server-only";
import { prisma } from "@ronde/db";
import { isLocale, type Locale } from "@ronde/i18n";
import { cache } from "react";
import { env } from "./env";
import { isCloud } from "./license";

// Settings of the whole instance, changed by its administrators. The environment variables give the
// starting values; what an administrator saves wins over them. The cloud is a public service: anyone may
// create an account there, and its operators work from their back-office, not from these settings.

export type SignupPolicy = "open" | "invite-only" | "domains";

export interface InstanceSettings {
  /** Language of people who have not picked one and whose browser offers none we have */
  defaultLocale: Locale;
  signupPolicy: SignupPolicy;
  /** Domains allowed to sign up with the "domains" policy */
  signupDomains: string[];
}

const KEYS = ["defaultLocale", "signupPolicy", "signupDomains"] as const;

const isPolicy = (v: unknown): v is SignupPolicy => v === "open" || v === "invite-only" || v === "domains";
export const cleanDomains = (list: string[]) => [
  ...new Set(list.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))),
];

/** Settings of the instance, read once per request */
export const instanceSettings = cache(async (): Promise<InstanceSettings> => {
  const rows = await prisma.instanceSetting.findMany({ where: { key: { in: [...KEYS] } } });
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    defaultLocale: isLocale(saved.defaultLocale) ? saved.defaultLocale : env.defaultLocale(),
    signupPolicy: isCloud() ? "open" : isPolicy(saved.signupPolicy) ? saved.signupPolicy : env.signupPolicy(),
    signupDomains: Array.isArray(saved.signupDomains) ? cleanDomains(saved.signupDomains.map(String)) : env.signupAllowedDomains(),
  };
});

export async function saveInstanceSettings(input: InstanceSettings): Promise<void> {
  const values: Record<(typeof KEYS)[number], unknown> = {
    defaultLocale: input.defaultLocale,
    signupPolicy: input.signupPolicy,
    signupDomains: cleanDomains(input.signupDomains),
  };
  await prisma.$transaction(
    KEYS.map((key) =>
      prisma.instanceSetting.upsert({
        where: { key },
        create: { key, value: values[key] as object },
        update: { value: values[key] as object },
      }),
    ),
  );
}
