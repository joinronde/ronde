// SPDX-License-Identifier: LicenseRef-Ronde-EE
import { createHmac } from "node:crypto";
import type { AuditRow } from "@ronde/editions/ee";
import { describe, expect, it, vi } from "vitest";
import { audit, sanitize } from "../src/audit";

const row: AuditRow = {
  id: "01a1",
  actorUserId: "u1",
  actorLabel: "Ana <ana@acme.test>",
  action: "settings.save",
  targetType: "meeting",
  targetId: "m1",
  meetingId: "m1",
  data: { teamName: "Weekly" },
  createdAt: "2026-10-07T10:00:00.000Z",
};

describe("audit details", () => {
  it("never keeps a secret, and cuts what is too long", () => {
    expect(sanitize({ token: "glpat-123", nested: { webhookSecret: "x", clientPassword: "" }, text: "a".repeat(600) })).toEqual({
      token: "[hidden]",
      nested: { webhookSecret: "[hidden]", clientPassword: "" },
      text: `${"a".repeat(500)}…`,
    });
  });

  it("keeps no phone number or birthday, whoever passes them", () => {
    expect(sanitize({ email: "ana@acme.com", phone: "+33612345678", birthday: "1990-04-02", set: ["phone"] })).toEqual({
      email: "ana@acme.com",
      phone: "[hidden]",
      birthday: "[hidden]",
      set: ["phone"],
    });
  });
});

describe("CSV export", () => {
  it("quotes every cell and defuses spreadsheet formulas", () => {
    const csv = audit.toCsv([{ ...row, actorLabel: '=HYPERLINK("http://evil")', data: { a: 'say "hi"' } }]);
    const [head, line] = csv.trim().split("\r\n");
    expect(head).toBe("date,actor,action,target_type,target_id,meeting_id,details");
    expect(line).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(line).toContain(`"{""a"":""say \\""hi\\""""}"`);
  });
});

describe("SIEM stream", () => {
  it("signs each entry like Ronde's webhooks", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response("ok"));
    await audit.stream(
      row,
      { url: "https://siem.acme.test/hook", secret: "s".repeat(32), workspace: "acme" },
      fetcher as unknown as typeof fetch,
    );
    const [url, init] = fetcher.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    const expected = createHmac("sha256", "s".repeat(32)).update(`${headers["X-Ronde-Timestamp"]}.${init.body}`).digest("hex");
    expect(url).toBe("https://siem.acme.test/hook");
    expect(headers["X-Ronde-Signature"]).toBe(`sha256=${expected}`);
    expect(JSON.parse(String(init.body))).toMatchObject({ event: "audit", workspace: "acme", entry: { action: "settings.save" } });
  });

  it("refuses a plain-http address and reports a failing endpoint", async () => {
    await expect(audit.stream(row, { url: "http://siem.acme.test", secret: "s", workspace: "acme" })).rejects.toThrow("unsafe");
    const failing = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(
      audit.stream(row, { url: "https://siem.acme.test", secret: "s", workspace: "acme" }, failing as unknown as typeof fetch),
    ).rejects.toThrow("500");
  });
});
