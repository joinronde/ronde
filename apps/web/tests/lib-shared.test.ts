import { afterEach, describe, expect, it, vi } from "vitest";
import { readAuditQuery } from "@/lib/shared/audit-query";
import { withBasePath } from "@/lib/shared/base-path";
import { isRepository, isWhatOf, SOURCE_KINDS, SOURCE_WHATS } from "@/lib/shared/project-sources";
import { readWikiError, WIKI_ERRORS, wikiErrorOf } from "@/lib/shared/wiki-error";

// What the server and the pages share: the audit log's filters from the address, a wiki's refusal kept and read
// back, what each tool imports as projects, and the app's base path

const query = (q: string) => readAuditQuery(new URLSearchParams(q));

describe("the audit log's filters", () => {
  it("are all empty for a bare address", () => {
    expect(query("")).toEqual({
      action: undefined,
      actor: undefined,
      from: undefined,
      to: undefined,
      after: undefined,
      fromDay: undefined,
      toDay: undefined,
    });
  });

  it("cover whole days in UTC, the first from midnight, the last to its final millisecond", () => {
    const q = query("from=2026-10-01&to=2026-10-13");
    expect(q.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(q.to?.toISOString()).toBe("2026-10-13T23:59:59.999Z");
    expect([q.fromDay, q.toDay]).toEqual(["2026-10-01", "2026-10-13"]);
  });

  it("take a single day from both ends, a leap day and the turn of the year", () => {
    const q = query("from=2028-02-29&to=2028-02-29");
    expect(q.to!.getTime() - q.from!.getTime()).toBe(24 * 3600_000 - 1);
    expect(query("from=2026-12-31&to=2027-01-01").to?.toISOString()).toBe("2027-01-01T23:59:59.999Z");
  });

  it("ignore a day not written YYYY-MM-DD", () => {
    for (const bad of ["13/10/2026", "2026-10-1", "2026-10-01T10:00", "yesterday", " 2026-10-01", "２０２６-10-01"]) {
      expect(query(`from=${encodeURIComponent(bad)}`)).toMatchObject({ from: undefined, fromDay: undefined });
    }
  });

  it("ignore a day that does not exist, rather than send an invalid date to the database", () => {
    for (const bad of ["2026-13-01", "2026-00-10", "2026-02-32", "2026-02-31", "2027-02-29"]) {
      const q = query(`from=${bad}&to=${bad}`);
      expect(q).toMatchObject({ from: undefined, to: undefined, fromDay: undefined, toDay: undefined });
    }
  });

  it("trim and cap the action and the actor, and drop them when blank", () => {
    expect(query(`action=${encodeURIComponent("  meeting. ")}`).action).toBe("meeting.");
    expect(query(`action=${"a".repeat(200)}`).action).toHaveLength(80);
    expect(query(`actor=${"é".repeat(200)}`).actor).toHaveLength(100);
    expect(query("action=%20%20&actor=").action).toBeUndefined();
    expect(query("actor=%20").actor).toBeUndefined();
  });

  it("search actors in any script", () => {
    expect(query(`actor=${encodeURIComponent("ليلى")}`).actor).toBe("ليلى");
    expect(query(`actor=${encodeURIComponent("李伟")}`).actor).toBe("李伟");
  });

  it("keep the page's cursor as it is", () => {
    expect(query("after=cm1x2y3z4000008l0abcd1234").after).toBe("cm1x2y3z4000008l0abcd1234");
    expect(query("after=").after).toBeUndefined();
  });

  it("read the first of a repeated filter", () => {
    expect(query("action=a&action=b").action).toBe("a");
  });
});

describe("a wiki's refusal", () => {
  /** Shaped as the Enterprise wikis throw it: a code, and what the wiki said ("" when nothing) */
  class WikiError extends Error {
    constructor(
      readonly code: string,
      readonly detail = "",
    ) {
      super(detail ? `${code}: ${detail}` : code);
    }
  }

  it("is kept as its code and what the wiki said", () => {
    expect(wikiErrorOf(new WikiError("token", "401 Unauthorized"))).toBe("token:401 Unauthorized");
    expect(wikiErrorOf(new WikiError("notionParent"))).toBe("notionParent");
  });

  it("counts an unknown code, or none, as the wiki's answer", () => {
    expect(wikiErrorOf(new WikiError("teapot", "418"))).toBe("answer:418");
    expect(wikiErrorOf(new Error("socket hang up"))).toBe("answer:socket hang up");
    expect(wikiErrorOf("plain text")).toBe("answer:plain text");
  });

  it("says nothing more when there is nothing to say", () => {
    expect(wikiErrorOf(null)).toBe("answer");
    expect(wikiErrorOf(undefined)).toBe("answer");
    expect(wikiErrorOf(new WikiError("network", ""))).toBe("network");
  });

  it("is kept to 300 characters, the code first", () => {
    const kept = wikiErrorOf(new WikiError("notionPage", "x".repeat(1000)));
    expect(kept).toHaveLength(300);
    expect(kept.startsWith("notionPage:x")).toBe(true);
  });

  it("is read back as it was kept, for every code", () => {
    for (const code of WIKI_ERRORS) {
      expect(readWikiError(wikiErrorOf(new WikiError(code, "Page « Roadmap » not found: 404")))).toEqual({
        code,
        detail: "Page « Roadmap » not found: 404",
      });
      expect(readWikiError(code)).toEqual({ code, detail: "" });
    }
  });

  it("keeps what the wiki said in any script, colons included", () => {
    expect(readWikiError("answer:خطأ: الصفحة غير موجودة")).toEqual({ code: "answer", detail: "خطأ: الصفحة غير موجودة" });
  });

  it("reads anything else as the wiki's answer, whole", () => {
    expect(readWikiError("teapot:418")).toEqual({ code: "answer", detail: "teapot:418" });
    expect(readWikiError("")).toEqual({ code: "answer", detail: "" });
    expect(readWikiError(":nothing")).toEqual({ code: "answer", detail: ":nothing" });
  });
});

describe("what each tool imports as projects", () => {
  it("is offered for every tool, at least one each", () => {
    for (const kind of SOURCE_KINDS) expect(SOURCE_WHATS[kind].length).toBeGreaterThan(0);
  });

  it("is checked against the tool", () => {
    expect(isWhatOf("github", "repos")).toBe(true);
    expect(isWhatOf("github", "epics")).toBe(false);
    expect(isWhatOf("jira", "epics")).toBe(true);
    expect(isWhatOf("linear", "milestones")).toBe(false);
    for (const odd of ["", null, undefined, 3, "REPOS", ["repos"]]) expect(isWhatOf("github", odd)).toBe(false);
  });

  it("is a repository for GitHub's repositories and GitLab's projects, not Linear's", () => {
    expect(isRepository("github", "repos")).toBe(true);
    expect(isRepository("gitlab", "projects")).toBe(true);
    expect(isRepository("linear", "projects")).toBe(false);
    expect(isRepository("github", "milestones")).toBe(false);
    expect(isRepository("jira", "epics")).toBe(false);
  });
});

describe("the base path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("adds nothing at the root of the domain", () => {
    expect(withBasePath("/api/w/acme/stream")).toBe("/api/w/acme/stream");
    expect(withBasePath("")).toBe("");
  });

  it("prefixes every app path behind a reverse proxy", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/ronde");
    vi.resetModules();
    const { withBasePath: under, BASE_PATH } = await import("@/lib/shared/base-path");
    expect(BASE_PATH).toBe("/ronde");
    expect(under("/api/w/acme/avatar/u1?v=3")).toBe("/ronde/api/w/acme/avatar/u1?v=3");
    expect(under("/")).toBe("/ronde/");
  });
});
