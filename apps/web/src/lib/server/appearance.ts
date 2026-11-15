import "server-only";
import { prisma } from "@ronde/db";
import { cookies } from "next/headers";
import { currentUser } from "./authz";

/** The cookie the theme switches write: what this browser shows */
export const THEME_COOKIE = "ronde-theme";

/**
 * Light or dark, the one theme every page applies and the account shows: this browser's choice (the switch
 * before signing in, or the account's), otherwise the one saved in the account, otherwise the device's (undefined)
 */
export async function appliedTheme(): Promise<"light" | "dark" | undefined> {
  const cookie = (await cookies()).get(THEME_COOKIE)?.value;
  if (cookie === "light" || cookie === "dark") return cookie;
  const user = await currentUser().catch(() => null);
  if (!user) return undefined;
  const saved = await prisma.userPref.findUnique({ where: { userId_key: { userId: user.id, key: "theme" } }, select: { value: true } });
  return saved?.value === "light" || saved?.value === "dark" ? saved.value : undefined;
}

/** The theme the account's appearance card shows checked: the one applied ("system" when the device decides) */
export async function shownTheme(): Promise<"light" | "dark" | "system"> {
  return (await appliedTheme()) ?? "system";
}
