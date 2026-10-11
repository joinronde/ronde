import { translator } from "@ronde/i18n";
import { authorize } from "@/lib/server/authz";
import { csvFile } from "@/lib/server/csv-file";
import { errorResponse } from "@/lib/server/http";
import { requestLocale } from "@/lib/server/locale";
import { workspaceDecisions } from "@/lib/server/overview";

export const dynamic = "force-dynamic";

/** Most decisions in one file */
const MAX_ROWS = 20_000;

// The decision log as a spreadsheet, with the page's search (?q=) and meeting (?meeting=)

export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const ctx = await authorize((await params).ws);
    const query = new URL(req.url).searchParams;
    const locale = await requestLocale();
    const meeting = query.get("meeting");
    const decisions = (await workspaceDecisions(ctx, locale, (query.get("q") ?? "").slice(0, 100), MAX_ROWS)).filter(
      (d) => !meeting || d.meetingId === meeting,
    );
    const t = translator(locale, "decisionsPage");
    return csvFile(
      [
        [t("csv.date"), t("csv.meeting"), t("csv.decision"), t("csv.context")],
        // The context reads "(Alice Martin)" after a decision: a column needs no brackets
        ...decisions.map((d) => [d.date, d.meeting, d.text, d.context.replace(/^\((.*)\)$/, "$1") || null]),
      ],
      locale,
      t("csv.fileName"),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
