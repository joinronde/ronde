// What a company directory (LDAP, SCIM) says about a person beyond their name and address: their phone, their
// team, their birthday, as Ronde keeps them

export interface DirectoryProfile {
  phone?: string;
  /** Name of their team (a department): the directory's team of that name, made if missing */
  team?: string;
  /** "MM-DD": the day only, never the year */
  birthday?: string;
}

const clean = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s.slice(0, max) : undefined;
};

/**
 * A birthday as directories write it, kept as "MM-DD": "1990-04-21", "19900421", "--04-21" (vCard), "04-21",
 * "21/04/1990"; anything else, or an impossible day, is left out
 */
export function birthdayOf(raw: unknown): string | undefined {
  const s = clean(raw, 40);
  if (!s) return undefined;
  const m = /^(?:\d{4}-?)?(\d{2})-?(\d{2})(?:[T ].*)?$/.exec(s) ?? /^--(\d{2})-?(\d{2})$/.exec(s) ?? /^(\d{2})\/(\d{2})\/\d{4}$/.exec(s);
  if (!m) return undefined;
  // "21/04/1990" is day first
  const [month, day] = s.includes("/") ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
  const mm = Number(month);
  const dd = Number(day);
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
  if (!days || dd < 1 || dd > days) return undefined;
  return `${month}-${day}`;
}

/** A phone number as the directory gives it, its spacing tidied: digits, spaces, "+", "(", ")", "." and "-" only */
export function phoneOf(raw: unknown): string | undefined {
  const s = clean(raw, 40);
  if (!s || !/^[+\d(][\d\s().-]{3,}$/.test(s) || s.replace(/\D/g, "").length < 4) return undefined;
  return s.replace(/\s+/g, " ");
}

/** The profile from the directory's values, each one only when it reads well */
export function directoryProfile(raw: { phone?: unknown; team?: unknown; birthday?: unknown }): DirectoryProfile {
  const out: DirectoryProfile = {};
  const phone = phoneOf(raw.phone);
  const team = clean(raw.team, 60);
  const birthday = birthdayOf(raw.birthday);
  if (phone) out.phone = phone;
  if (team) out.team = team;
  if (birthday) out.birthday = birthday;
  return out;
}
