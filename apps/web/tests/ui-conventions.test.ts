import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Conventions of the interface, checked in the source: what deletes or removes is red and drawn (no bare "✕"),
// whatever page it is on

const root = path.resolve(import.meta.dirname, "../src/components");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [path.join(dir, e.name)] : [],
  );
const sources = files(root).map((f) => ({ file: path.relative(root, f), text: readFileSync(f, "utf8") }));
const css = readFileSync(path.resolve(import.meta.dirname, "../src/app/globals.css"), "utf8");

/** Opening tags of the buttons, attributes included (they span several lines) */
const buttonTags = (text: string) => [...text.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);

describe("interface conventions", () => {
  it("draws its delete and remove buttons, never a bare ✕", () => {
    expect(sources.filter((s) => s.text.includes("✕")).map((s) => s.file)).toEqual([]);
  });

  it("makes every delete or remove button red", () => {
    const offenders = sources.flatMap((s) =>
      buttonTags(s.text)
        .filter((tag) => /aria-label=\{t\("[\w.]*(delete|remove)\w*"/i.test(tag) && !/dismiss/i.test(tag))
        .filter((tag) => !/\bdanger\b/.test(tag))
        .map((tag) => `${s.file}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("leaves the parts of a row (name, state, time, actions) to the rows' own rules", () => {
    // A page-level ".nm" (the new-meeting wizard) once centred the names of the control room's steps
    const parts = ["nm", "st", "tm", "acts"];
    const bare = (c: string) => new RegExp(String.raw`(^|\})\s*\.${c}\s*[{,:]`, "m");
    // The check itself catches such a rule
    expect(bare("nm").test(".x{a:b}\n.nm{margin:0 auto}")).toBe(true);
    expect(bare("nm").test(".run .nm{font-weight:500}")).toBe(false);
    expect(parts.filter((c) => bare(c).test(css))).toEqual([]);
  });

  it("never breaks the choices of a segmented control over two lines", () => {
    // "Cette année" in the decisions' period control once wrapped
    expect(css).toMatch(/\.seg button\{white-space:nowrap\}/);
  });

  it("starts a free text field one line high, growing to three lines", () => {
    // "Feedback" once opened four lines high beside one-line fields
    expect(css).toMatch(/textarea\.free-text\{min-height:44px;max-height:calc\(3lh \+ 22px\)/);
  });

  it("sets a person's lists in the minutes in under their labels", () => {
    // The bullets stuck out under the labels' dot: the content now sits in, its bullets where the labels' text starts
    expect(css).toMatch(/\.minutes-person\{--label-indent:14px\}/);
    expect(css).toMatch(
      /\.minutes-person > ul,\.minutes-doc \.minutes-person > div > ul\{[^}]*padding-inline-start:calc\(var\(--label-indent\) \+ 14px\);list-style:none/,
    );
    expect(css).toMatch(
      /\.minutes-person > ul > li::before,\.minutes-doc \.minutes-person > div > ul > li::before\{[^}]*inset-inline-start:-14px/,
    );
  });

  it("draws tables in written content striped, without a grid", () => {
    // The minutes' actions table had a border around every cell
    expect(css).toMatch(/\.md td,\.md th\{border:0/);
    expect(css).toMatch(/\.md tbody tr:nth-child\(even\)\{background:/);
    // "Emma Laurent" and "In progress" wrapped while the action column had room
    expect(css).toMatch(/\.minutes-doc \.tbl-wrap :is\(td,th\):not\(:first-child\)\{white-space:nowrap\}/);
  });

  it("tells the control room's fixed steps from the people's turns by the lines between them", () => {
    // Intro, open topics and wrap-up were cut off by the same faint line as two people's turns; a "step" class then
    // took the look of the wizard's step cards: the fixed steps are "fixed"
    expect(css).toMatch(/\.run li\.fixed\.cur\{background:var\(--live-soft\)\}/);
    expect(css).toMatch(/\.run li\.fixed\{background:[^}]*border-radius:9px/);
    expect(css).toMatch(/\.run li\.turn \+ li\.turn\{border-top:1px dashed/);
    const room = sources.find((s) => s.file.endsWith("control-room.tsx"))!.text;
    expect(room).toContain('p.person ? "turn" : p.cls === "qa" ? "" : "fixed"');
  });

  it("lays the meeting settings out without empty room or doubled titles", () => {
    // The video card ended on an empty line (its foot with nothing saved yet), and the save status pushed each
    // category's header below the side navigation's first item
    expect(css).toMatch(/\.form-foot:not\(:has\(button\)\):has\(> \.save-status:empty\)\{position:absolute/);
    expect(css).toMatch(/\.cfg-status\{[^}]*margin-inline-start:auto/);
    const settings = sources.find((s) => s.file.endsWith("settings.tsx") && s.file.startsWith("settings"))!.text;
    expect(settings.indexOf("className={`cfg-status")).toBeGreaterThan(settings.indexOf('<header className="cfg-head">'));
    // A panel alone under its category does not repeat the category's name
    const text = (f: string) => sources.find((s) => s.file === f)!.text;
    expect(text("schedule-panel.tsx")).not.toContain('{t("title")}</h3>');
    expect(text("modules-panel.tsx")).not.toContain('{t("title")}</h3>');
    expect(text("agenda-panel.tsx")).not.toMatch(
      /\{t\("title"\)\}<\/h3>\s*<p className="hint" style=\{\{ margin: 0 \}\}>\s*\{t\("intro"\)\}/,
    );
    // Notes that grow with their lines
    expect(css).toMatch(/textarea\.grow\{field-sizing:content/);
  });

  it("keeps the meeting's people as one table, and the agenda off as a whole while a session runs", () => {
    // The people's columns drifted from row to row, each row being its own grid
    expect(css).toMatch(/\.ptable > \.prow\{grid-column:1\/-1;grid-template-columns:subgrid\}/);
    const settings = sources.find((s) => s.file === "settings.tsx")!.text;
    expect(settings).toContain('aria-label={t("people.speaksOf", { name: m.name })}');
    // The agenda's remove buttons stayed bright and live while the agenda could not change
    expect(sources.find((s) => s.file === "agenda-panel.tsx")!.text).toContain(
      '<fieldset className="plain agenda-set" disabled={running}>',
    );
  });

  it("asks before closing the page on a check-in line typed without Enter", () => {
    // With the check-in saving itself, a line still in the "add" field (not joined to the list yet) was lost
    // when the page closed: nothing had changed for the save to see
    const fields = sources.find((s) => s.file === "check-in-fields.tsx")!.text;
    expect(fields).toMatch(/const typing = !!draft\.trim\(\);[\s\S]{0,200}addEventListener\("beforeunload"/);
  });

  it("keeps the notice of a check-in merged with another tab's after it saves itself", () => {
    // The save of its own that follows a merge, a second later, took the notice away before anyone could read it
    const me = sources.find((s) => s.file === "me.tsx")!.text;
    expect(me).toContain("if (okMessage) setMerged(false);");
    // Nor does the echo of that save, coming back from the server
    expect(me).toMatch(/if \(echo\) sent\.current = null;\s*else setMerged\(false\);/);
  });

  it("keeps the words of icon-only buttons in their names", () => {
    // The tab bar's buttons lost their words below 1560px (display:none): "Stop sharing" had no name left
    expect(css).not.toMatch(/\.tabs-actions \.hide-sm\{display:none/);
    expect(css).toMatch(/\.tabs-actions \.hide-sm\{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset\(50%\)/);
  });

  it("leaves data-tip to the app-wide tooltip: a page with its own tooltip uses another attribute", () => {
    // The stats page drew its own bubble for data-tip, and the app-wide one showed a second, elsewhere
    expect(sources.filter((s) => s.file !== "tooltips.tsx" && s.text.includes('"[data-tip]"')).map((s) => s.file)).toEqual([]);
  });
});
