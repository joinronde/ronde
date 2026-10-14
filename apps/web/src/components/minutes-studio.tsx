"use client";

import type { Step } from "@ronde/core/meeting";
import type { MinutesDoc } from "@ronde/core/minutes";
import { first } from "@ronde/core/util";
import { MdEditor } from "@ronde/ui/md-editor";
import { ArrowLeft, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, FileText, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MinutesView } from "./minutes-view";
import { useRonde } from "./ronde-provider";

// The minutes, read over before they are published, on the whole central space under the top bar: what to edit
// on the left (the summary, then each step), its editor in the middle, the minutes as they will read on the
// right, brought to the part being edited and following every keystroke

const SUMMARY = "__summary";

/** Where a step's notes land in the minutes shown: its person, or the part of its kind */
function targetOf(step: Step | undefined, doc: MinutesDoc, prefix: string): string | null {
  if (!step) return null;
  if (step.type === "speaker" || step.type === "project") return `${prefix}-p-${step.type === "project" ? step.projectId : step.key}`;
  const kind = step.type === "intro" ? "intro" : step.type === "misc" ? "topics" : step.type === "block" ? step.block : null;
  const i = doc.parts.findIndex((p) => p.kind === kind);
  return i >= 0 ? `${prefix}-${i}` : null;
}

export function MinutesStudio({
  doc,
  summary,
  setSummary,
  onClose,
  notesBox,
  tools,
}: {
  doc: MinutesDoc;
  summary: string;
  setSummary: (v: string) => void;
  onClose: () => void;
  /** The notes editor of a step (the control room's own) */
  notesBox: (step: Step) => React.ReactNode;
  /** What the head bar holds on the right: the content kept, publishing */
  tools: React.ReactNode;
}) {
  const t = useTranslations("control");
  const tMinutes = useTranslations("minutes");
  const { s, agenda } = useRonde();
  const steps = agenda.filter((x) => x.key && x.type !== "qa" && x.type !== "end");
  const noted = (key: string) => !!s.notes[key]?.trim();
  // The summary first: it is what the minutes open on
  const [sel, setSel] = useState<string>(SUMMARY);
  const order = [SUMMARY, ...steps.map((x) => x.key)];
  const at = order.indexOf(sel);
  const current = steps.find((x) => x.key === sel);
  const paper = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);

  // Under the top bar, whatever its height; the page behind does not scroll
  useLayoutEffect(() => {
    const place = () => setTop(Math.round(document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0));
    place();
    window.addEventListener("resize", place);
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    title.current?.focus();
    return () => {
      window.removeEventListener("resize", place);
      html.style.overflow = before;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // The minutes come to the part being edited, lit up a moment
  useEffect(() => {
    const summaryPart = doc.parts.findIndex((p) => p.kind === "summary");
    const id =
      sel === SUMMARY ? (summaryPart >= 0 ? `minutes-studio-${summaryPart}` : "studio-summary") : targetOf(current, doc, "minutes-studio");
    const el = id ? document.getElementById(id) : null;
    const box = paper.current;
    if (!el || !box) return;
    box.scrollTo({
      top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    el.classList.remove("studio-hit");
    void el.offsetWidth;
    el.classList.add("studio-hit");
    const timer = setTimeout(() => el.classList.remove("studio-hit"), 1400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const label = (x: Step) => (x.type === "speaker" ? first(x.label) : x.label);
  const host = document.querySelector(".app") ?? document.body;
  return createPortal(
    <div className="studio" role="dialog" aria-modal="true" aria-labelledby="studio-title" style={{ top }}>
      <header className="studio-head">
        <button type="button" className="btn studio-back" onClick={onClose}>
          <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" /> {t("studio.back")}
        </button>
        <div className="studio-title">
          <h2 id="studio-title" tabIndex={-1} ref={title}>
            <FileText size={18} strokeWidth={2} aria-hidden="true" /> {t("minutesPane.reviewTitle")}
          </h2>
          <span className="hint">{t("minutesPane.reviewHint")}</span>
        </div>
        <div className="studio-tools">{tools}</div>
      </header>
      <div className="studio-body">
        <nav className="studio-nav" aria-label={t("studio.sections")}>
          <button type="button" className="studio-item" aria-current={sel === SUMMARY ? "true" : undefined} onClick={() => setSel(SUMMARY)}>
            <Sparkles size={15} strokeWidth={2} aria-hidden="true" />
            <span className="studio-item-label">{tMinutes("summaryTitle")}</span>
            {summary.trim() ? (
              <CircleCheck size={15} strokeWidth={2.2} aria-label={t("studio.written")} className="studio-ok" />
            ) : (
              <span className="studio-todo">{t("studio.optional")}</span>
            )}
          </button>
          <p className="eyebrow studio-nav-title">{t("studio.steps")}</p>
          {steps.map((x) => (
            <button
              key={x.key}
              type="button"
              className={`studio-item${x.type === "speaker" ? " sub" : ""}`}
              aria-current={sel === x.key ? "true" : undefined}
              onClick={() => setSel(x.key)}
            >
              {noted(x.key) ? (
                <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" className="studio-ok" />
              ) : (
                <CircleDashed size={15} strokeWidth={2} aria-hidden="true" className="studio-empty" />
              )}
              <span className="studio-item-label">{label(x)}</span>
              <span className="sr-only">{noted(x.key) ? t("studio.written") : t("studio.noNotes")}</span>
            </button>
          ))}
        </nav>
        <section className="studio-edit" aria-label={t("minutesPane.reviewEdit")}>
          {sel === SUMMARY || !current ? (
            <>
              <h3>{tMinutes("summaryTitle")}</h3>
              <p className="hint">{t("minutesPane.summaryHint")}</p>
              <MdEditor
                id="studioSummary"
                label={tMinutes("summaryTitle")}
                placeholder={t("minutesPane.summaryPlaceholder")}
                className="studio-editor"
                value={summary}
                onChange={setSummary}
              />
            </>
          ) : (
            <div className="studio-notes" key={current.key}>
              {notesBox(current)}
            </div>
          )}
          <div className="studio-steps">
            <button type="button" className="btn" disabled={at <= 0} onClick={() => setSel(order[at - 1]!)}>
              <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" /> {t("studio.previous")}
            </button>
            <span className="hint">
              {at + 1} / {order.length}
            </span>
            <button type="button" className="btn" disabled={at >= order.length - 1} onClick={() => setSel(order[at + 1]!)}>
              {t("studio.next")} <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" />
            </button>
          </div>
        </section>
        <section className="studio-preview" aria-label={t("minutesPane.reviewPreview")}>
          <p className="eyebrow studio-preview-title">{t("minutesPane.reviewPreview")}</p>
          <div className="studio-paper" ref={paper}>
            <h2 className="studio-doc-title" id="studio-summary">
              {doc.title}
            </h2>
            <MinutesView doc={doc} id="studio" />
          </div>
        </section>
      </div>
    </div>,
    host,
  );
}
