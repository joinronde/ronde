"use client";

import { inlineToHtml, markdownToHtml } from "@ronde/core/markdown";
import type { LabelTone, MinutesBlock, MinutesDoc, MinutesItem, MinutesKind } from "@ronde/core/minutes";
import { initials, mmssPlain } from "@ronde/core/util";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef } from "react";
import { Icon, type IconName } from "./shell/icons";

// Minutes rendered from their tree: one part per kind, one card per person of the round table, labels
// coloured by the role of their section, and a table of contents.

const ICONS: Partial<Record<MinutesKind, IconName>> = {
  summary: "note",
  decisions: "flag",
  intro: "megaphone",
  mood: "cloudSun",
  icebreaker: "snowflake",
  round: "people",
  projects: "folder",
  timebox: "hourglass",
  retro: "search",
  poker: "cards",
  polls: "poll",
  topics: "pin",
  actions: "todo",
  kudos: "heart",
  rating: "star",
  blockers: "alert",
};

function PartIcon({ kind }: { kind: MinutesKind }) {
  const icon = ICONS[kind];
  if (!icon) return null;
  return (
    <span className="minutes-ico" aria-hidden="true">
      <Icon name={icon} size={18} />
    </span>
  );
}

/** Colour of a label: the styles name the check-in fields */
const KIND: Record<LabelTone, string> = {
  achievement: "done",
  plan: "next",
  blocker: "blockers",
  note: "other",
  custom: "other",
  notes: "notes",
  qa: "qa",
};

const Inline = ({ text }: { text: string }) => <span dangerouslySetInnerHTML={{ __html: inlineToHtml(text) }} />;

function Item({ item }: { item: MinutesItem }) {
  return (
    <li>
      {item.by && <strong>{item.by}: </strong>}
      {item.checked != null && <span aria-hidden="true">{item.checked ? "☑ " : "☐ "}</span>}
      <Inline text={item.text} />
      {item.likes ? <span className="muted"> (👍 {item.likes})</span> : null}
      {item.meta && <span className="muted">{item.meta}</span>}
      {item.context && <em className="muted"> {item.context}</em>}
      {item.children?.length ? (
        <ul>
          {item.children.map((c, i) => (
            <Item key={i} item={c} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Block({ block, prefix, index }: { block: MinutesBlock; prefix: string; index: number }) {
  const t = useTranslations("history");
  switch (block.type) {
    case "markdown":
      return <div dangerouslySetInnerHTML={{ __html: markdownToHtml(block.text) }} />;
    case "text":
      return <p>{block.text}</p>;
    case "label":
      return (
        <p className="minutes-label" data-kind={KIND[block.tone]}>
          <strong>{block.text}</strong>
        </p>
      );
    case "list":
      return (
        <ul>
          {block.items.map((item, i) => (
            <Item key={i} item={item} />
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                {block.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "person":
      return (
        <article className="minutes-person" id={`${prefix}-p-${block.id}`}>
          <header className="minutes-phead">
            <span className="minutes-av" aria-hidden="true" style={{ "--c": `var(--c${index % 6})` } as React.CSSProperties}>
              {initials(block.name)}
            </span>
            <h3>{block.name}</h3>
            {block.role && <span className="minutes-role">{block.role.toLowerCase()}</span>}
            <span className="minutes-time" title={t("speakingTime")}>
              ⏱ {mmssPlain(block.spentMs)}
            </span>
          </header>
          {block.blocks.map((b, i) => (
            <Block key={i} block={b} prefix={prefix} index={i} />
          ))}
        </article>
      );
    case "project":
      return (
        <article className="minutes-person minutes-project" id={`${prefix}-p-${block.id}`}>
          <header className="minutes-phead">
            <span className={`health-dot h-${block.health ?? "none"}`} aria-hidden="true" />
            <h3>{block.name}</h3>
            {block.theme && <span className="minutes-role">{block.theme}</span>}
            {block.healthLabel && <span className={`health-pill h-${block.health}`}>{block.healthLabel}</span>}
            <span className="minutes-time" title={t("speakingTime")}>
              ⏱ {mmssPlain(block.spentMs)}
            </span>
          </header>
          {block.blocks.map((b, i) => (
            <Block key={i} block={b} prefix={prefix} index={i} />
          ))}
        </article>
      );
  }
}

/** Highlights the search matches in the rendered minutes, ignoring accents and case */
function highlight(root: HTMLElement, query: string) {
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const q = fold(query);
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.data;
    // Folded text, and the original position of each of its characters
    let folded = "";
    const origin: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const f = fold(text[i]!);
      folded += f;
      for (let k = 0; k < f.length; k++) origin.push(i);
    }
    const parts: (string | HTMLElement)[] = [];
    let last = 0;
    for (let at = folded.indexOf(q); at >= 0; at = folded.indexOf(q, at + q.length)) {
      const start = origin[at]!;
      const end = origin[at + q.length - 1]! + 1;
      if (start < last) continue;
      parts.push(text.slice(last, start));
      const mark = doc.createElement("mark");
      mark.textContent = text.slice(start, end);
      parts.push(mark);
      last = end;
    }
    if (!parts.length) continue;
    parts.push(text.slice(last));
    node.replaceWith(...parts);
  }
}

export function MinutesView({ doc, id, query = "" }: { doc: MinutesDoc; id: string; query?: string }) {
  const t = useTranslations("history");
  const prefix = `minutes-${id}`;
  const article = useRef<HTMLElement>(null);
  // Matches are marked in the rendered text; a new search renders the minutes again first
  const key = `${id}:${query}:${doc.meta}`;
  useLayoutEffect(() => {
    if (query.length >= 2 && article.current) highlight(article.current, query);
  }, [key, query]);
  const toc = doc.parts.flatMap((p, i) => [
    { id: `${prefix}-${i}`, label: p.title, sub: false },
    ...p.blocks.flatMap((b) =>
      b.type === "person" || b.type === "project" ? [{ id: `${prefix}-p-${b.id}`, label: b.name, sub: true }] : [],
    ),
  ]);
  // The part reached lights up a moment, so the eye lands on it
  const go = (target: string) => {
    const el = document.getElementById(target);
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    el.classList.remove("studio-hit");
    void el.offsetWidth;
    el.classList.add("studio-hit");
    setTimeout(() => el.classList.remove("studio-hit"), 1400);
  };
  return (
    <div className="minutes-read">
      {toc.length > 2 && (
        <nav className="minutes-toc" aria-label={t("tocLabel")}>
          <div className="eyebrow">{t("toc")}</div>
          <ul>
            {toc.map((x) => (
              <li key={x.id} className={x.sub ? "sub" : ""}>
                <button type="button" onClick={() => go(x.id)}>
                  {x.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <article className="md minutes-doc" ref={article} key={key}>
        <p className="minutes-meta">
          <Inline text={doc.meta} />
        </p>
        {doc.parts.map((p, i) => (
          <section className="minutes-sec" id={`${prefix}-${i}`} key={p.kind}>
            <h2>
              <PartIcon kind={p.kind} />
              {p.title}
            </h2>
            {p.kind === "round" ? (
              <div className="minutes-people">
                {p.blocks.map((b, j) => (
                  <Block key={j} block={b} prefix={prefix} index={j} />
                ))}
              </div>
            ) : (
              p.blocks.map((b, j) => <Block key={j} block={b} prefix={prefix} index={j} />)
            )}
          </section>
        ))}
        <p className="minutes-next">{doc.next}</p>
      </article>
    </div>
  );
}
