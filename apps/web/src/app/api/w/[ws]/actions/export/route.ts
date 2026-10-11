import { translator } from "@ronde/i18n";
import { authorize } from "@/lib/server/authz";
import { csvFile } from "@/lib/server/csv-file";
import { errorResponse } from "@/lib/server/http";
import { requestLocale } from "@/lib/server/locale";
import { hostsMeetings, listActions } from "@/lib/server/my-actions";

export const dynamic = "force-dynamic";

// The actions of the page as a spreadsheet (?view=hosted, ?meeting=): every one, also those done long ago

export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const ctx = await authorize((await params).ws);
    const query = new URL(req.url).searchParams;
    const view = query.get("view") === "hosted" && (await hostsMeetings(ctx)) ? "hosted" : "mine";
    const meeting = query.get("meeting");
    const actions = (await listActions(ctx, view, { all: true })).filter((a) => !meeting || a.meetingId === meeting);
    const locale = await requestLocale();
    const t = translator(locale, "actions");
    const status = { open: t("group.open"), doing: t("group.doing"), done: t("csv.done") };
    return csvFile(
      [
        [
          t("csv.action"),
          t("csv.owner"),
          t("csv.meeting"),
          t("csv.status"),
          t("csv.decided"),
          t("csv.doneOn"),
          t("csv.carried"),
          t("csv.ticket"),
        ],
        ...actions.map((a) => [
          a.text,
          a.owner.name,
          a.meeting,
          status[a.status],
          a.originDate,
          a.doneAt?.slice(0, 10),
          a.carried || null,
          a.ticket?.url ?? null,
        ]),
      ],
      locale,
      t("csv.fileName"),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
