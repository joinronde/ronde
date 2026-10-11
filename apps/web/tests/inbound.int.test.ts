import { reminderEmail } from "@ronde/core/notifications";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyReply, inboundAddress, replyMessageId, replyTarget, replyText } from "@/lib/server/inbound";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Check-ins written in a reply to the reminder: the reminder's signed Message-ID names the person and the
// meeting, the reply's new lines go into their check-in, and only from them

let f: Fixture;
let member: { id: string; email: string };

beforeAll(async () => {
  vi.stubEnv("INBOUND_IMAP_URL", "imaps://checkins%40ronde.test:secret@imap.ronde.test/INBOX");
  f = await meeting(await workspace("inbound"), "Replied weekly");
  member = await prisma.person.findUniqueOrThrow({ where: { id: f.memberId }, select: { id: true, email: true } });
});
afterAll(() => vi.unstubAllEnvs());

describe("the reminder's Message-ID", () => {
  it("names the person and the meeting, signed, on the inbound address's domain", () => {
    expect(inboundAddress()).toBe("checkins@ronde.test");
    const id = replyMessageId(member.id, f.meetingId)!;
    expect(id).toMatch(/^<ck\.[0-9a-f]{32}\.[0-9a-f]{32}\.\w+\.[\w-]{22}@ronde\.test>$/);
    // Mail clients repeat it in In-Reply-To, or in the References of a longer thread
    expect(replyTarget([id])).toEqual({ personId: member.id, meetingId: f.meetingId });
    expect(replyTarget([undefined, `<other@x.test> ${id}`])).toEqual({ personId: member.id, meetingId: f.meetingId });
  });

  it("is refused when altered or too old", () => {
    const id = replyMessageId(member.id, f.meetingId)!;
    expect(replyTarget([id.replace(/\.([\w-]{22})@/, ".AAAAAAAAAAAAAAAAAAAAAA@")])).toBeNull();
    // Someone else's meeting under the same signature
    expect(replyTarget([id.replace(/ck\.([0-9a-f]{32})\.([0-9a-f]{32})/, (_, p) => `ck.${p}.${"0".repeat(32)}`)])).toBeNull();
    expect(replyTarget([id], Date.now() + 15 * 86_400_000)).toBeNull();
  });

  it("says in the email that a reply works, with the sections to write", () => {
    const mail = reminderEmail({
      settings: {
        teamName: "Replied weekly",
        targetMin: 25,
        speakSec: 120,
        videoUrl: "",
        sections: [
          { key: "done", label: "", role: "achievement", input: "list" },
          { key: "next", label: "", role: "plan", input: "list" },
        ],
      },
      locale: "en",
      date: "2026-10-12",
      time: "10:00",
      name: "Ines Moreau",
      checkInUrl: "https://ronde.test/me",
      planned: [],
      actions: [],
      reply: true,
    });
    expect(mail.text).toContain("Short on time? Reply to this email");
    expect(mail.text).toContain("Done this week\n- …\nPlanned for next week\n- …");
  });
});

describe("a reply", () => {
  const quoted = (body: string) =>
    `${body}\n\nOn Mon, Oct 12, 2026 at 09:00, Ronde <checkins@ronde.test> wrote:\n> Hello Ines,\n> Done this week\n> - …`;

  it("keeps only what the person wrote", () => {
    expect(replyText(quoted("Done this week\n- Shipped the export"))).toBe("Done this week\n- Shipped the export");
  });

  it("adds its new lines to the check-in, under their sections", async () => {
    const text = replyText(
      quoted("Done this week:\n- Shipped the export\n- shipped\nPlanned next week: Write the docs\nBlockers\n- No staging access"),
    );
    expect(await applyReply({ personId: member.id, meetingId: f.meetingId, from: member.email.toUpperCase(), text })).toBe("added");
    const mine = (await loadSnapshot(f.ctx)).checkIns[member.id]!;
    // "shipped" was in the check-in already: not twice
    expect(mine.done).toEqual(["shipped", "Shipped the export"]);
    expect(mine.next).toEqual(["Write the docs"]);
    expect(mine.blockers).toEqual(["No staging access"]);
    // The same reply again adds nothing; a reply with nothing to read says so
    expect(await applyReply({ personId: member.id, meetingId: f.meetingId, from: member.email, text })).toBe("already");
    expect(await applyReply({ personId: member.id, meetingId: f.meetingId, from: member.email, text: "\n- …\n" })).toBe("nothing");
  });

  it("is refused from another address, or for a meeting the person does not speak in", async () => {
    const text = "Done this week\n- Hijacked";
    expect(await applyReply({ personId: member.id, meetingId: f.meetingId, from: "someone@else.test", text })).toBe("refused");
    await prisma.meetingParticipant.updateMany({ where: { meetingId: f.meetingId, personId: member.id }, data: { role: "observer" } });
    expect(await applyReply({ personId: member.id, meetingId: f.meetingId, from: member.email, text })).toBe("refused");
    await prisma.meetingParticipant.updateMany({ where: { meetingId: f.meetingId, personId: member.id }, data: { role: "participant" } });
    expect((await loadSnapshot(f.ctx)).checkIns[member.id]!.done).not.toContain("Hijacked");
  });
});
