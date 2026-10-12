import { afterEach, describe, expect, it, vi } from "vitest";
import { invitationsPerDay, invite } from "@/lib/server/workspaces";
import { meeting, workspace } from "./fixtures";

// Invitations are emails sent on someone's behalf: a person sends a limited number a day (RONDE_INVITES_PER_DAY,
// 100 in the cloud), so the cloud never relays anyone's mass mailing; a self-hosted server sets its own

afterEach(() => vi.unstubAllEnvs());

describe("invitations", () => {
  it("stop at the day's limit for the person sending them", async () => {
    vi.stubEnv("RONDE_INVITES_PER_DAY", "3");
    const f = await meeting(await workspace(`invites-${Date.now().toString(36)}`), "Weekly");
    for (let i = 1; i <= 3; i++) await invite(f.ctx.ws, { firstName: `Guest ${i}`, email: `guest${i}@invites.test`, role: "member" });
    await expect(invite(f.ctx.ws, { firstName: "Guest 4", email: "guest4@invites.test", role: "member" })).rejects.toMatchObject({
      key: "tooManyInvitations",
      values: { count: 3 },
    });
  });

  it("have no limit on a self-hosted server unless it sets one, and 100 a day in the cloud", () => {
    vi.stubEnv("RONDE_INVITES_PER_DAY", "");
    expect(invitationsPerDay()).toBe(0);
    vi.stubEnv("RONDE_CLOUD", "1");
    expect(invitationsPerDay()).toBe(100);
    vi.stubEnv("RONDE_INVITES_PER_DAY", "500");
    expect(invitationsPerDay()).toBe(500);
  });
});
