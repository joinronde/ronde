"use client";

import type { PollDTO } from "@ronde/core/types";
import {
  ChartColumn,
  Check,
  CircleDot,
  Cloud,
  EyeOff,
  Gauge,
  ListChecks,
  Lock,
  LockOpen,
  type LucideIcon,
  Monitor,
  MonitorOff,
  Plus,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRonde } from "./ronde-provider";
import { Avatar } from "./stage";

// Polls: asked from the control room, answered from "My screen", results on the shared screen

const KINDS = ["single", "multiple", "scale", "words"] as const;
type Kind = (typeof KINDS)[number];
const KIND_ICONS: Record<Kind, LucideIcon> = { single: CircleDot, multiple: ListChecks, scale: Gauge, words: Cloud };
/** Words one person gives to the cloud */
const MAX_WORDS = 3;

/** The faces of the people who answered, a few of them and how many more */
function PollFaces({ ids, max = 5 }: { ids: string[]; max?: number }) {
  const { members, people } = useRonde();
  if (!ids.length) return null;
  const names = ids.map((id) => members[id]?.name ?? people[id]?.name ?? "").filter(Boolean);
  return (
    <span className="poll-faces" title={names.join(", ")}>
      {ids.slice(0, max).map((id, i) => (
        <Avatar key={`${id}-${i}`} id={id} sm />
      ))}
      {ids.length > max && <span className="av sm poll-faces-more">+{ids.length - max}</span>}
      <span className="sr-only">{names.join(", ")}</span>
    </span>
  );
}

/** Totals as bars (choices, scale), green and red for a yes or no, or a cloud of words */
export function PollResults({ poll }: { poll: PollDTO }) {
  const t = useTranslations("polls");
  const max = Math.max(1, ...poll.results.map((r) => r.count));
  const total = poll.results.reduce((n, r) => n + r.count, 0);
  if (poll.kind === "words")
    return poll.results.length ? (
      <p className="poll-cloud">
        {poll.results.map((r, i) => (
          <span
            key={r.value}
            style={{ fontSize: `${0.9 + (r.count / max) * 1.4}em`, "--c": `var(--c${i % 6})` } as React.CSSProperties}
            title={t("count", { count: r.count })}
          >
            {r.value}
          </span>
        ))}
      </p>
    ) : (
      <p className="hint">{t("noAnswer")}</p>
    );
  return (
    <ul className={"poll-bars" + (poll.yesNo ? " yesno" : "")}>
      {poll.results.map((r) => {
        const leading = r.count > 0 && r.count === max;
        return (
          <li key={r.value} className={leading ? "lead" : undefined}>
            <span className="poll-label">{r.value}</span>
            <span className="poll-bar" aria-hidden="true">
              <i style={{ width: `${(r.count / max) * 100}%` }} />
            </span>
            <span className="poll-n">
              {r.count}
              {total > 0 && <small> · {Math.round((r.count / total) * 100)}%</small>}
            </span>
            {!poll.anonymous && r.ids.length > 0 && <PollFaces ids={r.ids} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Shared screen: the poll the host chose to show */
export function PollBand() {
  const t = useTranslations("polls");
  const { s } = useRonde();
  const poll = s.polls.find((p) => p.shown);
  if (!poll) return null;
  return (
    <div className="poll-band" role="status">
      <span className="eyebrow">
        <ChartColumn size={14} strokeWidth={2.2} aria-hidden="true" /> {t("poll")} · {t("answers", { count: poll.answers })}
      </span>
      <h3>{poll.question}</h3>
      <PollResults poll={poll} />
    </div>
  );
}

/** A few words for the cloud: typed one by one (Enter or a comma adds it), shown as chips */
function WordsInput({ values, onChange, label }: { values: string[]; onChange: (v: string[]) => void; label: string }) {
  const t = useTranslations("polls");
  const [draft, setDraft] = useState("");
  const add = (typed = draft) => {
    const word = typed.trim().replace(/,$/, "");
    if (!word || values.length >= MAX_WORDS || values.some((v) => v.toLowerCase() === word.toLowerCase())) return setDraft("");
    onChange([...values, word]);
    setDraft("");
  };
  return (
    <div className="words-input">
      {values.map((w) => (
        <span key={w} className="word-chip">
          {w}
          <button
            type="button"
            className="danger"
            aria-label={t("removeWord", { word: w })}
            onClick={() => onChange(values.filter((v) => v !== w))}
          >
            <X size={12} strokeWidth={2.6} aria-hidden="true" />
          </button>
        </span>
      ))}
      {values.length < MAX_WORDS && (
        <input
          aria-label={label}
          maxLength={30}
          value={draft}
          placeholder={values.length ? t("wordMore") : t("wordFirst")}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => add()}
        />
      )}
      <span className="words-count" aria-live="polite">
        {t("wordsLeft", { count: values.length, max: MAX_WORDS })}
      </span>
    </div>
  );
}

/** "My screen": answer the open polls */
export function PollsPanel() {
  const t = useTranslations("polls");
  const { s, rpc } = useRonde();
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const open = s.polls.filter((p) => p.open);
  if (!open.length || !s.viewer.memberId) return null;
  return (
    <section className="panel polls-panel" aria-labelledby="polls-title">
      <h2 id="polls-title" className="polls-title">
        <ChartColumn size={18} strokeWidth={2.2} aria-hidden="true" /> {t("answerTitle")}
      </h2>
      {open.map((p) => {
        const values = drafts[p.id] ?? p.mine ?? [];
        const set = (v: string[]) => setDrafts((d) => ({ ...d, [p.id]: v }));
        const choices = p.kind === "scale" ? ["1", "2", "3", "4", "5"] : p.options;
        const KindIcon = KIND_ICONS[p.kind];
        const changed = JSON.stringify(values) !== JSON.stringify(p.mine ?? []);
        const send = async (v: string[]) => {
          const clean = v.map((x) => x.trim()).filter(Boolean);
          if (clean.length && (await rpc({ op: "polls.answer", pollId: p.id, values: clean }, t("sent"))))
            setDrafts((d) => {
              const { [p.id]: _, ...rest } = d;
              return rest;
            });
        };
        return (
          <form
            key={p.id}
            className={`poll-card${p.mine ? " answered" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              void send(values);
            }}
          >
            <header className="poll-card-head">
              <span className="poll-kind" aria-hidden="true">
                <KindIcon size={18} strokeWidth={2} />
              </span>
              <div className="poll-card-q">
                <h3>{p.question}</h3>
                <span className="poll-meta">
                  {t(`kinds.${p.kind}`)}
                  {p.anonymous && (
                    <span className="poll-anon">
                      <EyeOff size={13} strokeWidth={2} aria-hidden="true" /> {t("anonymous")}
                    </span>
                  )}
                  <span>· {t("answers", { count: p.answers })}</span>
                </span>
              </div>
              {!p.anonymous && <PollFaces ids={p.respondents ?? []} />}
            </header>
            {/* A yes or no: two big buttons, sent at once */}
            {p.yesNo ? (
              <div className="poll-yesno" role="group" aria-label={p.question}>
                {choices.map((c, i) => {
                  const YesNoIcon = i === 0 ? ThumbsUp : ThumbsDown;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`poll-yn ${i === 0 ? "yes" : "no"}`}
                      aria-pressed={(p.mine ?? []).includes(c)}
                      onClick={() => void send([c])}
                    >
                      <YesNoIcon size={22} strokeWidth={2} aria-hidden="true" /> {c}
                    </button>
                  );
                })}
              </div>
            ) : (
              <fieldset className="plain">
                <legend className="sr-only">{p.question}</legend>
                {p.kind === "words" ? (
                  <WordsInput values={values} onChange={set} label={t("word", { n: values.length + 1 })} />
                ) : (
                  <div className={p.kind === "scale" ? "poll-scale" : "poll-options"}>
                    {choices.map((c) => (
                      <label key={c} className={`poll-choice${values.includes(c) ? " on" : ""}`}>
                        <input
                          type={p.kind === "multiple" ? "checkbox" : "radio"}
                          name={`poll-${p.id}`}
                          checked={values.includes(c)}
                          onChange={(e) =>
                            set(p.kind === "multiple" ? (e.target.checked ? [...values, c] : values.filter((v) => v !== c)) : [c])
                          }
                        />
                        <span>{c}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            {!p.yesNo && (
              <div className="controls poll-card-foot">
                {p.mine && !changed ? (
                  <span className="poll-done">
                    <Check size={15} strokeWidth={2.6} aria-hidden="true" /> {t("answered")}
                  </span>
                ) : (
                  <button type="submit" className="btn primary sm" disabled={!values.some((v) => v.trim())}>
                    <Send size={14} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" /> {p.mine ? t("change") : t("send")}
                  </button>
                )}
              </div>
            )}
            {/* Once answered, where the team stands (an anonymous poll shows the totals only) */}
            {p.mine && p.answers > 0 && (
              <div className="poll-live">
                <PollResults poll={p} />
              </div>
            )}
          </form>
        );
      })}
    </section>
  );
}

/** Control room: ask a question, open or close it, show its results on the shared screen */
export function PollsHost() {
  const t = useTranslations("polls");
  const { s, rpc } = useRonde();
  const [question, setQuestion] = useState("");
  const [kind, setKind] = useState<Kind>("single");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [anonymous, setAnonymous] = useState(true);
  if (!s.modules.polls) return null;
  const list = options.map((o) => o.trim()).filter(Boolean);
  const choicesNeeded = kind === "single" || kind === "multiple";
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await rpc({ op: "polls.create", question: question.trim(), kind, options: choicesNeeded ? list : [], anonymous }, t("created"))) {
      setQuestion("");
      setOptions(["", ""]);
    }
  };
  return (
    <div className="stack">
      <div className="poll-quick">
        <button
          type="button"
          className="btn primary"
          aria-describedby="pollQuickHint"
          onClick={async () => {
            const q = question.trim() || t("yesNoQuestion");
            if (
              await rpc(
                {
                  op: "polls.create",
                  question: q,
                  kind: "single",
                  options: [t("yes"), t("no")],
                  anonymous: false,
                  show: true,
                  yesNo: true,
                },
                t("created"),
              )
            )
              setQuestion("");
          }}
        >
          <ThumbsUp size={16} strokeWidth={2} aria-hidden="true" /> {t("yesNo")}
        </button>
        <span id="pollQuickHint" className="hint">
          {t("yesNoHint")}
        </span>
      </div>
      <form className="form poll-new" onSubmit={create}>
        <div className="field">
          <label htmlFor="pollQuestion">{t("question")}</label>
          <input
            id="pollQuestion"
            required
            maxLength={200}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("questionPlaceholder")}
          />
        </div>
        <fieldset className="plain">
          <legend className="lbl-s">{t("kind")}</legend>
          <div className="poll-kinds">
            {KINDS.map((k) => {
              const KindIcon = KIND_ICONS[k];
              return (
                <label key={k} className={`poll-kind-opt${kind === k ? " on" : ""}`}>
                  <input type="radio" name="pollKind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
                  <KindIcon size={18} strokeWidth={2} aria-hidden="true" />
                  <span>{t(`kinds.${k}`)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {choicesNeeded && (
          <fieldset className="plain poll-options-edit">
            <legend className="lbl-s">{t("choices")}</legend>
            {options.map((o, i) => (
              <div key={i} className="poll-option-row">
                <span className="poll-option-n" aria-hidden="true">
                  {i + 1}
                </span>
                <input
                  aria-label={t("choiceN", { n: i + 1 })}
                  maxLength={100}
                  value={o}
                  placeholder={t("choiceN", { n: i + 1 })}
                  onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && i === options.length - 1 && o.trim()) {
                      e.preventDefault();
                      setOptions([...options, ""]);
                    }
                  }}
                />
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={t("removeChoice", { n: i + 1 })}
                  disabled={options.length <= 2}
                  onClick={() => setOptions(options.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}
            {options.length < 12 && (
              <button type="button" className="btn ghost sm" onClick={() => setOptions([...options, ""])}>
                <Plus size={14} strokeWidth={2.2} aria-hidden="true" /> {t("addChoice")}
              </button>
            )}
          </fieldset>
        )}
        <div className="poll-new-foot">
          <label className="switch">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <EyeOff size={15} strokeWidth={2} aria-hidden="true" /> {t("anonymousToggle")}
          </label>
          <button type="submit" className="btn primary" disabled={!question.trim() || (choicesNeeded && list.length < 2)}>
            <Send size={15} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" /> {t("ask")}
          </button>
        </div>
      </form>
      {s.polls.map((p) => {
        const KindIcon = KIND_ICONS[p.kind];
        return (
          <article key={p.id} className={`poll-host${p.shown ? " shown" : ""}`}>
            <header>
              <span className="poll-kind" aria-hidden="true">
                <KindIcon size={16} strokeWidth={2} />
              </span>
              <strong>{p.question}</strong>
              <span className={`st-pill ${p.open ? "st-doing" : "st-open"}`}>{p.open ? t("open") : t("closed")}</span>
              <span className="hint">{t("answers", { count: p.answers })}</span>
            </header>
            <PollResults poll={p} />
            <div className="controls">
              <button type="button" className="btn sm" onClick={() => rpc({ op: "polls.close", pollId: p.id, open: !p.open })}>
                {p.open ? <Lock size={14} strokeWidth={2} aria-hidden="true" /> : <LockOpen size={14} strokeWidth={2} aria-hidden="true" />}
                {p.open ? t("close") : t("reopen")}
              </button>
              <button
                type="button"
                className={`btn sm${p.shown ? " on" : ""}`}
                aria-pressed={p.shown}
                onClick={() => rpc({ op: "polls.show", pollId: p.shown ? null : p.id })}
              >
                {p.shown ? (
                  <MonitorOff size={14} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Monitor size={14} strokeWidth={2} aria-hidden="true" />
                )}
                {p.shown ? t("hide") : t("show")}
              </button>
              <span className="sep" />
              <button
                type="button"
                className="icon-btn danger"
                aria-label={t("delete", { question: p.question })}
                onClick={() => rpc({ op: "polls.delete", pollId: p.id })}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
