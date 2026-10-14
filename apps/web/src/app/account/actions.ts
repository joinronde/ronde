"use server";

import { isTheme } from "@ronde/core/appearance";
import { prisma } from "@ronde/db";
import { isLocale, LOCALE_COOKIE } from "@ronde/i18n";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { setAccountBirthday } from "@/lib/server/account-birthday";
import { deleteAccount } from "@/lib/server/account-data";
import { run } from "@/lib/server/action";
import { requireUser } from "@/lib/server/authz";
import { OpError } from "@/lib/server/errors";
import { PUSH_KINDS, type PushKind, removePushDevice, savePushDevice, setPushKind, testPush } from "@/lib/server/push";
import { setWeeklySummary } from "@/lib/server/weekly";
import { HIDE_UPGRADE_HINTS } from "@/lib/shared/prefs";

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Name, language and time zone; an empty language or time zone follows the browser */
export async function updateProfileAction(input: { name: string; locale: string; timezone: string }) {
  return run(async () => {
    const user = await requireUser();
    const name = input.name.trim();
    if (!name) throw new OpError("nameRequired");
    const locale = isLocale(input.locale) ? input.locale : null;
    const timezone = input.timezone && isTimeZone(input.timezone) ? input.timezone : null;
    await prisma.user.update({ where: { id: user.id }, data: { name, locale, timezone } });
    const jar = await cookies();
    if (locale) jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
    else jar.delete(LOCALE_COOKIE);
    revalidatePath("/", "layout");
    return null;
  });
}

/** The birthday on the person's cards in every workspace ("MM-DD"), or none */
export async function setBirthdayAction(birthday: string | null) {
  return run(async () => {
    const user = await requireUser();
    await setAccountBirthday(user.id, birthday);
    revalidatePath("/account");
    return null;
  });
}

const THEME_COOKIE = "ronde-theme";

/** Light, dark or the device's theme: saved for the user, and in a cookie so pages render in it at once */
export async function setThemeAction(theme: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isTheme(theme)) throw new OpError("invalidRequest", { details: "theme" });
    await prisma.userPref.upsert({
      where: { userId_key: { userId: user.id, key: "theme" } },
      create: { userId: user.id, key: "theme", value: theme },
      update: { value: theme },
    });
    const jar = await cookies();
    if (theme === "system") jar.delete(THEME_COOKIE);
    else jar.set(THEME_COOKIE, theme, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
    return null;
  });
}

/** The weekly summary by email: turned off or on again */
export async function setWeeklySummaryAction(on: boolean) {
  return run(async () => {
    const user = await requireUser();
    await setWeeklySummary(user.id, on);
    return null;
  });
}

/** Suggestions of the paid plans, shown to workspace administrators: hidden or shown again */
export async function setUpgradeHintsAction(show: boolean) {
  return run(async () => {
    const user = await requireUser();
    const where = { userId_key: { userId: user.id, key: HIDE_UPGRADE_HINTS } };
    if (show) await prisma.userPref.deleteMany({ where: { userId: user.id, key: HIDE_UPGRADE_HINTS } });
    else
      await prisma.userPref.upsert({ where, create: { userId: user.id, key: HIDE_UPGRADE_HINTS, value: true }, update: { value: true } });
    return null;
  });
}

/** This browser or phone gets the person's push notifications */
export async function savePushDeviceAction(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, label: string) {
  return run(async () => {
    const user = await requireUser();
    try {
      await savePushDevice(user.id, sub, label);
    } catch {
      throw new OpError("invalidRequest", { details: "subscription" });
    }
    revalidatePath("/account");
    return null;
  });
}

/** A device that no longer gets them (this one, or another one from the list) */
export async function removePushDeviceAction(id: string) {
  return run(async () => {
    const user = await requireUser();
    await removePushDevice(user.id, id);
    revalidatePath("/account");
    return null;
  });
}

/** One kind of push notification turned off or on again */
export async function setPushKindAction(kind: string, on: boolean) {
  return run(async () => {
    const user = await requireUser();
    if (!PUSH_KINDS.includes(kind as PushKind)) throw new OpError("invalidRequest", { details: "kind" });
    await setPushKind(user.id, kind as PushKind, on);
    return null;
  });
}

/** A notification sent to the person's own devices, to see that it works; returns how many got it */
export async function testPushAction() {
  return run(async () => {
    const user = await requireUser();
    return testPush(user.id, isLocale(user.locale) ? user.locale : "en");
  });
}

/** Deletes the account for good, confirmed by its address (see deleteAccount) */
export async function deleteAccountAction(confirmation: string) {
  return run(async () => {
    const user = await requireUser();
    // Its sessions went with it: the browser signs out next (the client clears its cookies)
    await deleteAccount(user, confirmation);
    return null;
  });
}
