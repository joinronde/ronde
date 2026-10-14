import { localDate } from "@ronde/core/schedule";
import { getTranslations } from "next-intl/server";
import { CalendarView } from "@/components/workspace/calendar";
import { pageWorkspace } from "@/lib/server/authz";
import { calendarEvents } from "@/lib/server/calendar-view";

export async function generateMetadata() {
  const t = await getTranslations("calendar");
  return { title: `${t("title")} · Ronde` };
}

const pad = (n: number) => String(n).padStart(2, "0");

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const ctx = await pageWorkspace((await params).ws);
  // Today where the person is (not in UTC: an evening in America is already tomorrow there)
  const today = localDate(Date.now(), ctx.user.timezone ?? ctx.workspace.timezone);
  const asked = (await searchParams).month;
  const month = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : today.slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  // The grid shows whole weeks, Monday first: from the Monday before the 1st to the Sunday after the last day
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * 86_400_000);
  const last = new Date(Date.UTC(y, m, 0));
  const end = new Date(last.getTime() + ((7 - last.getUTCDay()) % 7) * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  // The list beside the grid: the next four weeks, whatever the month shown
  const [events, upcoming] = await Promise.all([
    calendarEvents(ctx, iso(start), iso(end)),
    calendarEvents(ctx, today, iso(new Date(Date.now() + 28 * 86_400_000))),
  ]);
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  };
  return (
    <CalendarView
      slug={ctx.workspace.slug}
      month={month}
      start={iso(start)}
      end={iso(end)}
      today={today}
      events={events}
      upcoming={upcoming.filter((e) => e.status === "planned" || e.status === "live").slice(0, 8)}
      prev={shift(-1)}
      next={shift(1)}
    />
  );
}
