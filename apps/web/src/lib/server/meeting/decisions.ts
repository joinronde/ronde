import "server-only";
import { recordDecisions } from "@ronde/core/minutes";
import { parseRecord } from "@ronde/core/record";
import type { DecisionDTO } from "@ronde/core/types";
import type { ScopedClient } from "@ronde/db";
import type { Locale } from "@ronde/i18n";

/** Comparable text: lower case, no accents */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Decision log: the decisions noted in every archived session of a meeting, newest first; with a query, those containing it */
export async function decisionLog(db: ScopedClient, meetingId: string, locale: Locale, query = ""): Promise<DecisionDTO[]> {
  const q = fold(query.trim());
  const rows = await db.session.findMany({
    where: { meetingId, status: "archived" },
    orderBy: { date: "desc" },
    // A few years of weekly sessions at most
    take: 520,
    select: { date: true, record: true },
  });
  const items: DecisionDTO[] = [];
  for (const r of rows) {
    const record = parseRecord(r.record);
    if (!record) continue;
    for (const d of recordDecisions(record, locale))
      if (!q || fold(`${d.text} ${d.context ?? ""}`).includes(q)) items.push({ date: r.date, text: d.text, context: d.context ?? "" });
  }
  return items;
}
