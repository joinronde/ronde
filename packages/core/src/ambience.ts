import { formatters, type Locale, translator } from "@ronde/i18n";

// Waiting-screen ambience: a theme picked from the date (holidays, "dev" days, seasons).
// Greetings live in the "ambience" messages.

export type AmbienceMotion = "fall" | "rise" | "drift" | "twinkle";

export interface Ambience {
  key: string;
  /** Items that animate the screen */
  particles: string[];
  motion: AmbienceMotion;
}

/** Ambience with its greeting, shown above the team name */
export type ResolvedAmbience = Ambience & { greeting: string };

export const AMBIENCES: Ambience[] = [
  { key: "new-year", particles: ["🎆", "✨", "🎉", "🥂"], motion: "twinkle" },
  { key: "kings-cake", particles: ["👑", "🥧", "✨"], motion: "fall" },
  { key: "candlemas", particles: ["🥞", "🍯", "🍓"], motion: "fall" },
  { key: "valentines", particles: ["💜", "💕", "💌"], motion: "rise" },
  { key: "pi-day", particles: ["π", "🥧", "3.14", "∞"], motion: "drift" },
  { key: "april-fools", particles: ["🐟", "🐠", "🐡", "🫧"], motion: "drift" },
  { key: "easter", particles: ["🥚", "🐣", "🍫", "🐰"], motion: "fall" },
  { key: "easter-april-fools", particles: ["🐟", "🥚", "🐣", "🐠", "🍫"], motion: "drift" },
  { key: "star-wars", particles: ["⭐", "✨", "🌌", "🪐"], motion: "twinkle" },
  { key: "music-day", particles: ["🎵", "🎶", "🎸", "🥁"], motion: "rise" },
  { key: "bastille-day", particles: ["🎆", "🎇", "✨"], motion: "twinkle" },
  { key: "back-to-school", particles: ["🎒", "✏️", "📚", "📐"], motion: "fall" },
  { key: "programmers-day", particles: ["💻", "⌨️", "0", "1", "🐛", "{ }"], motion: "fall" },
  { key: "halloween", particles: ["🎃", "🦇", "👻", "🕸️"], motion: "drift" },
  { key: "christmas", particles: ["❄️", "🎄", "⛄", "🎁"], motion: "fall" },
  { key: "holidays", particles: ["✨", "🎉", "❄️", "🥂"], motion: "twinkle" },
  { key: "winter", particles: ["❄️", "❅", "❆"], motion: "fall" },
  { key: "spring", particles: ["🌸", "🌱", "🌼"], motion: "fall" },
  { key: "summer", particles: ["☀️", "🍉", "🕶️", "🍦"], motion: "rise" },
  { key: "autumn", particles: ["🍂", "🍁", "🍄"], motion: "fall" },
  { key: "birthday", particles: ["🎈", "🎂", "🎉", "🎁", "🥳"], motion: "rise" },
];

const byKey = (k: string) => AMBIENCES.find((a) => a.key === k)!;

/** Easter Sunday (Gregorian calendar) */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Number of days from `from` to `to` */
const dayDiff = (to: Date, from: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);

const dayOfYear = (d: Date) =>
  Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1;

/**
 * Theme of the day (local date). Each holiday covers at least 7 days, usually the week before it and
 * a day or two after: a weekly meeting always falls inside, even when the holiday is a day off or not
 * the meeting day.
 */
export function ambienceFor(d: Date): Ambience {
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const md = mo * 100 + day;
  const between = (from: number, to: number) => md >= from && md <= to;
  const e = easter(d.getFullYear());
  const fromEaster = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - e.getTime()) / 86_400_000);
  const doy = dayOfYear(d);
  // Day 256: September 13 (12 in leap years)
  const devDay = new Date(d.getFullYear(), 0, 256);
  const fromDevDay = doy - dayOfYear(devDay);

  if (between(101, 110)) return byKey("new-year");
  if (between(111, 127)) return byKey("kings-cake");
  if (between(128, 208)) return byKey("candlemas");
  if (between(209, 217)) return byKey("valentines");
  if (between(309, 317)) return byKey("pi-day");
  // Easter: from the Monday of Holy Week to Easter Monday. In years when it overlaps April Fools'
  // (March 27 – April 4), a shared theme covers both periods so neither gets shortened.
  const inEaster = fromEaster >= -6 && fromEaster <= 1;
  const inFish = between(327, 404);
  // [Easter − 6, Easter + 1] and [March 27, April 4] overlap
  const overlap = dayDiff(e, new Date(d.getFullYear(), 3, 4)) <= 6 && dayDiff(e, new Date(d.getFullYear(), 2, 27)) >= -1;
  if (overlap && (inEaster || inFish)) return byKey("easter-april-fools");
  if (inEaster) return byKey("easter");
  if (inFish) return byKey("april-fools");
  if (between(428, 506)) return byKey("star-wars");
  if (between(615, 623)) return byKey("music-day");
  if (between(706, 716)) return byKey("bastille-day");
  if (fromDevDay >= -6 && fromDevDay <= 2) return byKey("programmers-day");
  if (between(825, 906)) return byKey("back-to-school");
  if (between(1017, 1102)) return byKey("halloween");
  if (between(1201, 1224)) return byKey("christmas");
  if (between(1225, 1231)) return byKey("holidays");
  if (md >= 1221 || md < 320) return byKey("winter");
  if (md < 621) return byKey("spring");
  if (md < 923) return byKey("summer");
  return byKey("autumn");
}

/** Days around the date when a birthday is celebrated: 7 days in all, so a weekly meeting falls inside */
const BIRTHDAY_SPAN = 3;

/** First names, in team order, of the people whose birthday ("MM-DD") falls within ± 3 days of `today` */
export function birthdaysAround(members: { name: string; birthday: string | null }[], today: Date): string[] {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return members
    .filter(({ birthday }) => {
      if (!birthday) return false;
      const [mo, d] = birthday.split("-").map(Number);
      // Around January 1st, the closest birthday may fall in the previous or the next year
      return [-1, 0, 1].some((dy) => {
        const y = day.getFullYear() + dy;
        // February 29 is celebrated on the 28th in non-leap years
        const leap = new Date(y, 1, 29).getMonth() === 1;
        const date = mo === 2 && d === 29 && !leap ? new Date(y, 1, 28) : new Date(y, mo - 1, d);
        return Math.abs(dayDiff(date, day)) <= BIRTHDAY_SPAN;
      });
    })
    .map((m) => m.name.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** Greeting of an ambience; the birthday one names the people celebrated */
function withGreeting(ambience: Ambience, locale: Locale, names: string[] = []): ResolvedAmbience {
  const t = translator(locale, "ambience");
  const greeting =
    ambience.key === "birthday" && names.length
      ? t("birthdayNamed", { names: formatters(locale).list(names) })
      : t(ambience.key as "birthday");
  return { ...ambience, greeting };
}

/**
 * Choice made on the shared screen: "auto" (from the date), "off", or a theme key.
 * In "auto", a birthday this week wins over holidays and seasons.
 */
export function resolveAmbience(
  choice: string | null | undefined,
  today: Date,
  locale: Locale,
  members: { name: string; birthday: string | null }[] = [],
): ResolvedAmbience | null {
  if (choice === "off") return null;
  if (choice === "birthday") return withGreeting(byKey("birthday"), locale, birthdaysAround(members, today));
  if (choice && choice !== "auto") return withGreeting(AMBIENCES.find((a) => a.key === choice) ?? ambienceFor(today), locale);
  const names = birthdaysAround(members, today);
  return names.length ? withGreeting(byKey("birthday"), locale, names) : withGreeting(ambienceFor(today), locale);
}
