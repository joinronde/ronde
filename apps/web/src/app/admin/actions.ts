"use server";

import { isLocale } from "@ronde/i18n";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/server/action";
import { requireUser } from "@/lib/server/authz";
import { AccessError, OpError } from "@/lib/server/errors";
import { setFeedbackStatus } from "@/lib/server/feedback";
import { saveInstanceSettings } from "@/lib/server/instance";
import { isCloud, saveLicense } from "@/lib/server/license";

/** Who may change the instance: its administrators, on a self-hosted instance (the cloud has its back-office) */
async function requireInstanceAdmin() {
  const user = await requireUser();
  if (user.instanceRole !== "admin" || isCloud()) throw new AccessError(403, "accessDenied");
  return user;
}

/** Instance settings: only its administrators */
export async function saveInstanceSettingsAction(input: { defaultLocale: string; signupPolicy: string; signupDomains: string }) {
  return run(async () => {
    await requireInstanceAdmin();
    if (!isLocale(input.defaultLocale)) throw new OpError("invalidRequest", { details: "locale" });
    const policy = input.signupPolicy;
    if (policy !== "open" && policy !== "invite-only" && policy !== "domains") throw new OpError("invalidRequest", { details: "policy" });
    const domains = input.signupDomains.split(/[\s,;]+/);
    await saveInstanceSettings({ defaultLocale: input.defaultLocale, signupPolicy: policy, signupDomains: domains });
    revalidatePath("/", "layout");
    return null;
  });
}

const LICENSE_ERRORS = {
  format: "licenseFormat",
  payload: "licenseFormat",
  signature: "licenseSignature",
  unknownKey: "licenseUnknownKey",
} as const;

/** License key of the instance: checked before it is kept; an empty key removes it */
export async function saveLicenseAction(key: string) {
  return run(async () => {
    await requireInstanceAdmin();
    const state = await saveLicense(String(key).slice(0, 4000));
    if (state.status === "invalid") throw new OpError(LICENSE_ERRORS[state.reason]);
    revalidatePath("/", "layout");
    return null;
  });
}

/** A message of "Send feedback" handled, archived or opened again */
export async function feedbackStatusAction(id: string, status: string) {
  return run(async () => {
    const user = await requireInstanceAdmin();
    await setFeedbackStatus(String(id), String(status), user.email);
    revalidatePath("/admin");
    return null;
  });
}
