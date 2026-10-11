import { prisma } from "@ronde/db";
import type { SendMailOptions, Transporter } from "nodemailer";
import { beforeAll, describe, expect, it } from "vitest";
import { isoWeek, sendWeeklySummaries, setWeeklySummary, unsubscribeLink, validUnsubscribe } from "@/lib/server/weekly";
import { type Fixture, meeting, workspace } from "./fixtures";

// Monday's summary: each member's sessions, open actions and kudos, once a week, with a way out

let f: Fixture;
const sent: SendMailOptions[] = [];
const transport = {
  sendMail: async (m: SendMailOptions) => {
    sent.push(m);
    return {};
  },
} as unknown as Transporter;
// The fixture's meeting meets on Mondays at 10:00 from 2030-01-07
const monday = new Date("2030-01-07T09:00:00Z");

beforeAll(async () => {
  f = await meeting(await workspace("weekly"), "Product weekly");
  await prisma.kudo.updateMany({ where: { workspaceId: f.workspaceId }, data: { createdAt: new Date("2030-01-06T10:00:00Z") } });
  await prisma.action.create({
    data: { workspaceId: f.workspaceId, meetingId: f.meetingId, text: "Write the quarterly report", ownerId: f.ctx.ws.member.personId },
  });
});

describe("weekly summary", () => {
  it("tells each member their week: sessions, open actions and kudos, once", async () => {
    expect(await sendWeeklySummaries(new Date("2030-01-07T07:30:00Z"), transport)).toBe(0);
    expect(await sendWeeklySummaries(monday, transport)).toBe(1);
    const mail = sent[0]!;
    expect(mail.to).toBe(f.ctx.ws.user.email);
    expect(mail.subject).toBe("Your week with weekly");
    expect(mail.html).toContain("Product weekly");
    expect(mail.html).toContain("Write the quarterly report");
    expect(mail.html).toContain("thanks");
    expect(String(mail.text)).toContain(`/w/weekly/m/${f.meetingId}/me`);
    expect((mail.headers as Record<string, string>)["List-Unsubscribe"]).toContain("/api/unsubscribe/weekly?u=");
    // Once a week
    expect(await sendWeeklySummaries(new Date("2030-01-07T10:30:00Z"), transport)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("stops when the person turns it off, with a link nobody else can forge", async () => {
    const userId = f.ctx.ws.user.id;
    const link = new URL(await unsubscribeLink(userId));
    expect(validUnsubscribe(userId, link.searchParams.get("t")!)).toBe(true);
    expect(validUnsubscribe(userId, "forged")).toBe(false);
    await setWeeklySummary(userId, false);
    expect(await sendWeeklySummaries(new Date("2030-01-14T09:00:00Z"), transport)).toBe(0);
    await setWeeklySummary(userId, true);
    expect(await sendWeeklySummaries(new Date("2030-01-14T09:00:00Z"), transport)).toBe(1);
  });

  it("counts weeks the ISO way", () => {
    expect(isoWeek("2030-01-07")).toBe("2030-W02");
    expect(isoWeek("2026-12-31")).toBe("2026-W53");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
  });
});
