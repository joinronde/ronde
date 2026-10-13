import { afterEach, describe, expect, it, vi } from "vitest";
import { type FeedbackForIssue, issueUrl, joinLink, REPO, trackerTarget, whatsOf } from "@/lib/shared/links";

// Addresses built for people to follow: what a GitHub issue made from a feedback message lets out, the video
// call's link, and what a saved issue tracker can import

const feedback = (patch: Partial<FeedbackForIssue> & { context?: FeedbackForIssue["context"] } = {}): FeedbackForIssue => ({
  kind: "bug",
  message: "The timer stops\nwhen I switch tabs",
  context: { path: "/w/acme/m/cm1x2y3z4000008l0abcd1234/control", version: "1.4.0", browser: "Firefox", viewport: "1280×800" },
  ...patch,
});
/** The issue's fields, as GitHub reads them */
const fields = (url: string) => {
  const u = new URL(url);
  return {
    base: `${u.origin}${u.pathname}`,
    title: u.searchParams.get("title")!,
    body: u.searchParams.get("body")!,
    labels: u.searchParams.get("labels"),
  };
};
const pageOf = (path: string) => fields(issueUrl(feedback({ context: { path } }))).body.match(/Page: `(.*)`/)?.[1];

describe("a GitHub issue from a feedback message", () => {
  it("opens a new issue of the Ronde project, titled with the first line", () => {
    const f = fields(issueUrl(feedback()));
    expect(f.base).toBe(`${REPO}/issues/new`);
    expect(f.title).toBe("The timer stops");
    expect(f.body).toBe("The timer stops\nwhen I switch tabs\n\n---\nRonde 1.4.0 · Firefox · 1280×800\nPage: `/w/…/m/…/control`");
  });

  it("files a problem as a bug and anything else as an idea", () => {
    expect(fields(issueUrl(feedback({ kind: "bug" }))).labels).toBe("bug");
    expect(fields(issueUrl(feedback({ kind: "idea" }))).labels).toBe("enhancement");
    expect(fields(issueUrl(feedback({ kind: "other" }))).labels).toBe("enhancement");
    expect(fields(issueUrl(feedback({ kind: "" }))).labels).toBe("enhancement");
  });

  it("hides the workspace and every id in the page's address, whatever their shape", () => {
    // A slug, a cuid, a uuid, a number, an email standing as an id
    expect(pageOf("/w/acme-corp/m/cm1x2y3z4000008l0abcd1234/history")).toBe("/w/…/m/…/history");
    expect(pageOf("/w/acme/people/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("/w/…/people/…");
    expect(pageOf("/w/acme/projects/42")).toBe("/w/…/projects/…");
    expect(pageOf("/w/acme/people/jane.doe@example.com")).toBe("/w/…/people/…");
    expect(pageOf("/g/Xk9_aZ-31")).toBe("/g/…");
    // Unicode slugs too
    expect(pageOf("/w/ورشة/projects/项目-一")).toBe("/w/…/projects/…");
  });

  it("hides an id followed by more of the address, and every one of several", () => {
    expect(pageOf("/w/acme/m/abc/people/def")).toBe("/w/…/m/…/people/…");
    expect(pageOf("/w/acme/m/abc?step=2")).toBe("/w/…/m/…");
  });

  it("keeps the kind of page, which holds no id", () => {
    expect(pageOf("/w/acme/meetings/new")).toBe("/w/…/meetings/new");
    expect(pageOf("/w/acme/settings/audit")).toBe("/w/…/settings/audit");
    expect(pageOf("/w/acme/people")).toBe("/w/…/people");
    expect(pageOf("/account")).toBe("/account");
  });

  it("leaves the page out when it is unknown, and says which version it does not know", () => {
    const f = fields(issueUrl(feedback({ context: {} })));
    expect(f.body).toBe("The timer stops\nwhen I switch tabs\n\n---\nRonde ? · ");
    expect(f.body).not.toContain("Page:");
  });

  it("adds the error's reference when the message came from an error page", () => {
    const f = fields(issueUrl(feedback({ context: { version: "1.4.0", errorRef: "a1b2c3" } })));
    expect(f.body).toContain("\nError reference: `a1b2c3`");
  });

  it("never names the person who wrote, nor their workspace", () => {
    const row = {
      ...feedback(),
      from: { name: "Camille Martin", email: "camille@example.com" },
      workspace: { name: "Acme Corp", slug: "acme" },
    };
    const url = decodeURIComponent(issueUrl(row));
    for (const leak of ["Camille", "camille@example.com", "Acme Corp", "/w/acme"]) expect(url).not.toContain(leak);
  });

  it("caps the title at 90 characters", () => {
    expect(fields(issueUrl(feedback({ message: "a".repeat(200) }))).title).toBe("a".repeat(90));
  });

  it("does not cut an emoji in half at the end of the title", () => {
    // 89 letters then a two-unit emoji: the 90th unit is half of it
    const f = fields(issueUrl(feedback({ message: `${"a".repeat(89)}🎉 party` })));
    expect(f.title).toBe("a".repeat(89));
    expect(f.title).not.toContain("�");
  });

  it("shortens a long message, so the address stays under what GitHub accepts", () => {
    // Chinese takes 9 characters per character once encoded: the worst case
    const long = "会议".repeat(2500);
    const url = issueUrl(feedback({ message: long }));
    const f = fields(url);
    expect(f.body.startsWith(`${long.slice(0, 1200)}…\n\n---\n`)).toBe(true);
    expect(url.length).toBeLessThan(12_500);
  });

  it("keeps a message of exactly 1200 characters whole", () => {
    const f = fields(issueUrl(feedback({ message: "x".repeat(1200) })));
    expect(f.body.startsWith(`${"x".repeat(1200)}\n`)).toBe(true);
  });

  it("does not cut an emoji in half where a long message is shortened", () => {
    const f = fields(issueUrl(feedback({ message: `${"a".repeat(1199)}${"😀".repeat(100)}` })));
    expect(f.body.startsWith(`${"a".repeat(1199)}…`)).toBe(true);
  });

  it("carries right-to-left text and line breaks as they are", () => {
    const message = "المؤقت يتوقف\nعند تبديل علامات التبويب";
    const f = fields(issueUrl(feedback({ message })));
    expect(f.title).toBe("المؤقت يتوقف");
    expect(f.body.startsWith(message)).toBe(true);
  });

  it("makes an issue of an empty message all the same", () => {
    const f = fields(issueUrl(feedback({ message: "" })));
    expect(f.title).toBe("");
    expect(f.body.startsWith("\n\n---\nRonde 1.4.0")).toBe(true);
  });
});

describe("the video call's link", () => {
  const jitsi = (videoUrl: string) => ({ videoUrl, video: { provider: "jitsi" } });

  it("gives Jitsi the person's name, so they need not type it", () => {
    expect(joinLink(jitsi("https://meet.jit.si/RondeAbc"), "Zoë")).toBe(
      `https://meet.jit.si/RondeAbc#userInfo.displayName=${encodeURIComponent('"Zoë"')}`,
    );
  });

  it("escapes a name that could break out of the address", () => {
    const url = joinLink(jitsi("https://meet.jit.si/R"), 'Ana "AJ" O\'Neil & co #1');
    const sent = url.split("#userInfo.displayName=")[1]!;
    // Spaces, quotes, "&" and "#" would end the value or start another one (an apostrophe is allowed there)
    expect(sent).not.toMatch(/[ "&#]/);
    expect(JSON.parse(decodeURIComponent(sent))).toBe('Ana "AJ" O\'Neil & co #1');
  });

  it("passes right-to-left and Chinese names whole", () => {
    for (const name of ["ليلى حداد", "李伟"]) {
      const sent = joinLink(jitsi("https://meet.jit.si/R"), name).split("=")[1]!;
      expect(JSON.parse(decodeURIComponent(sent))).toBe(name);
    }
  });

  it("leaves Jitsi's link alone when the name is unknown", () => {
    expect(joinLink(jitsi("https://meet.jit.si/R"), "")).toBe("https://meet.jit.si/R");
  });

  it("leaves any other call's link as it is", () => {
    const zoom = { videoUrl: "https://zoom.us/j/123?pwd=abc", video: { provider: "link" } };
    expect(joinLink(zoom, "Zoë")).toBe("https://zoom.us/j/123?pwd=abc");
  });

  it("keeps Ronde's own entry (BigBlueButton) on this server", () => {
    const bbb = { videoUrl: "/w/acme/m/abc/video", video: { provider: "bbb" } };
    expect(joinLink(bbb, "Zoë")).toBe("/w/acme/m/abc/video");
  });
});

describe("the video call's link under a base path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("puts Ronde's own entry under it, and only that one", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/ronde");
    vi.resetModules();
    const { joinLink: under } = await import("@/lib/shared/links");
    expect(under({ videoUrl: "/w/acme/m/abc/video", video: { provider: "bbb" } }, "")).toBe("/ronde/w/acme/m/abc/video");
    expect(under({ videoUrl: "https://meet.jit.si/R", video: { provider: "link" } }, "")).toBe("https://meet.jit.si/R");
  });
});

describe("what a saved issue tracker leads to", () => {
  it("lists a GitHub repository's organization, or the repository's milestones", () => {
    const tr = { kind: "github" as const, where: "acme/web" };
    expect(trackerTarget(tr, "repos")).toBe("acme");
    expect(trackerTarget(tr, "milestones")).toBe("acme/web");
  });

  it("lists a GitLab project's group, subgroups included", () => {
    const tr = { kind: "gitlab" as const, where: "acme/platform/api" };
    expect(trackerTarget(tr, "projects")).toBe("acme/platform");
    expect(trackerTarget(tr, "milestones")).toBe("acme/platform/api");
  });

  it("has no group for a GitLab project named by its number", () => {
    expect(trackerTarget({ kind: "gitlab", where: "12345" }, "projects")).toBeNull();
  });

  it("has no organization when the repository is not known", () => {
    expect(trackerTarget({ kind: "github", where: "" }, "repos")).toBeNull();
    expect(trackerTarget({ kind: "github", where: "/web" }, "repos")).toBeNull();
  });

  it("is the Jira project or the Linear team itself", () => {
    expect(trackerTarget({ kind: "jira", where: "OPS" }, "epics")).toBe("OPS");
    expect(trackerTarget({ kind: "linear", where: "Équipe 🚀" }, "projects")).toBe("Équipe 🚀");
  });

  it("keeps names in other scripts as they are", () => {
    expect(trackerTarget({ kind: "gitlab", where: "فريق/مشروع" }, "projects")).toBe("فريق");
    expect(trackerTarget({ kind: "github", where: "团队/仓库" }, "repos")).toBe("团队");
  });
});

describe("what can be imported", () => {
  it("is everything the tool offers when no tracker is chosen, the first one first", () => {
    expect(whatsOf("github")).toEqual(["repos", "milestones"]);
    expect(whatsOf("gitlab")).toEqual(["projects", "milestones"]);
    expect(whatsOf("jira")).toEqual(["epics"]);
    expect(whatsOf("linear")).toEqual(["projects"]);
  });

  it("leaves out the group's projects for a GitLab tracker named by number", () => {
    expect(whatsOf("gitlab", { kind: "gitlab", where: "12345" })).toEqual(["milestones"]);
    expect(whatsOf("gitlab", { kind: "gitlab", where: "acme/api" })).toEqual(["projects", "milestones"]);
  });

  it("offers nothing through a GitHub tracker that names no repository", () => {
    expect(whatsOf("github", { kind: "github", where: "" })).toEqual([]);
  });

  it("does not filter Jira and Linear trackers", () => {
    expect(whatsOf("jira", { kind: "jira", where: "" })).toEqual(["epics"]);
    expect(whatsOf("linear", { kind: "linear", where: "" })).toEqual(["projects"]);
  });
});
