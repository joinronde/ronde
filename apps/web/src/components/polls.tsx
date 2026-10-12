"use client";

import type { PollDTO } from "@ronde/core/types";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Select } from "@/components/select";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";

// Polls: asked from the control room, answered from "My screen", results on the shared screen

const KINDS = ["single", "multiple", "scale", "words"] as const;

/** Totals as bars (choices, scale) or as a cloud of words */
export function PollResults({ poll }: { poll: PollDTO }) {
  const t = useTranslations("polls");
  const max = Math.max(1, ...poll.results.map((r) => r.count));
  if (poll.kind === "words")
    return poll.results.length ? (
      <p className="poll-cloud">
        {poll.results.map((r) => (
          <span key={r.value} style={{ fontSize: `${0.9 + (r.count / max) * 1.4}em` }} title={t("count", { count: r.count })}>
            {r.value}
          </span>
        ))}
      </p>
    ) : (
      <p className="hint">{t("noAnswer")}</p>
    );
  // A yes or no: the answers read at a glance, green and red
  const yesNo = poll.kind === "single" && poll.options.length === 2 && poll.options[0] === t("yes") && poll.options[1] === t("no");
  return (
    <ul className={"poll-bars" + (yesNo ? " yesno" : "")}>
      {poll.results.map((r) => (
        <li key={r.value}>
          <span className="poll-label">{r.value}</span>
          <span className="poll-bar" aria-hidden="true">
            <i style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="poll-n">{r.count}</span>
          {!poll.anonymous && r.people.length > 0 && <span className="hint poll-people">{r.people.join(", ")}</span>}
        </li>
      ))}
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
        <Icon name="poll" size={14} /> {t("poll")} · {t("answers", { count: poll.answers })}
      </span>
      <h3>{poll.question}</h3>
      <PollResults poll={poll} />
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
    <section className="panel retro-panel" aria-labelledby="polls-title">
      <h2 id="polls-title">{t("answerTitle")}</h2>
      {open.map((p) => {
        const values = drafts[p.id] ?? p.mine ?? [];
        const set = (v: string[]) => setDrafts((d) => ({ ...d, [p.id]: v }));
        const choices = p.kind === "scale" ? ["1", "2", "3", "4", "5"] : p.options;
        return (
          <form
            key={p.id}
            className="poll-answer"
            onSubmit={async (e) => {
              e.preventDefault();
              const clean = values.map((v) => v.trim()).filter(Boolean);
              if (clean.length) await rpc({ op: "polls.answer", pollId: p.id, values: clean }, t("sent"));
            }}
          >
            <fieldset>
              <legend>
                <strong>{p.question}</strong> {p.anonymous && <span className="hint">· {t("anonymous")}</span>}
              </legend>
              {p.kind === "words" ? (
                <div className="poll-words">
                  {[0, 1, 2].map((i) => (
                    <input
                      key={i}
                      aria-label={t("word", { n: i + 1 })}
                      maxLength={30}
                      value={values[i] ?? ""}
                      onChange={(e) => {
                        const next = [...values];
                        next[i] = e.target.value;
                        set(next);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className={p.kind === "scale" ? "poll-scale" : "poll-options"}>
                  {choices.map((c) => (
                    <label key={c} className="check">
                      <input
                        type={p.kind === "multiple" ? "checkbox" : "radio"}
                        name={`poll-${p.id}`}
                        checked={values.includes(c)}
                        onChange={(e) =>
                          set(p.kind === "multiple" ? (e.target.checked ? [...values, c] : values.filter((v) => v !== c)) : [c])
                        }
                      />{" "}
                      {c}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <div className="controls">
              <button type="submit" className="btn primary sm">
                {p.mine ? t("change") : t("send")}
              </button>
              {p.mine && <span className="hint">✓ {t("answered")}</span>}
            </div>
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
  const [kind, setKind] = useState<(typeof KINDS)[number]>("single");
  const [options, setOptions] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  if (!s.modules.polls) return null;
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = options
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    if (await rpc({ op: "polls.create", question: question.trim(), kind, options: list, anonymous }, t("created"))) {
      setQuestion("");
      setOptions("");
    }
  };
  return (
    <div className="stack">
      <div className="controls poll-quick">
        <button
          type="button"
          className="btn primary"
          aria-describedby="pollQuickHint"
          onClick={async () => {
            const q = question.trim() || t("yesNoQuestion");
            if (
              await rpc(
                { op: "polls.create", question: q, kind: "single", options: [t("yes"), t("no")], anonymous: false, show: true },
                t("created"),
              )
            )
              setQuestion("");
          }}
        >
          👍👎 {t("yesNo")}
        </button>
        <span id="pollQuickHint" className="hint">
          {t("yesNoHint")}
        </span>
      </div>
      <form className="form" onSubmit={create}>
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
        <div className="grid2">
          <div className="field">
            <label htmlFor="pollKind">{t("kind")}</label>
            <Select id="pollKind" value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          <label className="check" style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> {t("anonymousToggle")}
          </label>
        </div>
        {(kind === "single" || kind === "multiple") && (
          <div className="field">
            <label htmlFor="pollOptions">{t("options")}</label>
            <textarea
              id="pollOptions"
              required
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder={t("optionsPlaceholder")}
            />
          </div>
        )}
        <div>
          <button type="submit" className="btn primary" disabled={!question.trim()}>
            {t("ask")}
          </button>
        </div>
      </form>
      {s.polls.map((p) => (
        <article key={p.id} className="poll-host">
          <header>
            <strong>{p.question}</strong>
            <span className="hint">
              {t("answers", { count: p.answers })} · {p.open ? t("open") : t("closed")}
            </span>
          </header>
          <PollResults poll={p} />
          <div className="controls">
            <button type="button" className="btn sm" onClick={() => rpc({ op: "polls.close", pollId: p.id, open: !p.open })}>
              {p.open ? t("close") : t("reopen")}
            </button>
            <button
              type="button"
              className="btn sm"
              aria-pressed={p.shown}
              onClick={() => rpc({ op: "polls.show", pollId: p.shown ? null : p.id })}
            >
              {p.shown ? t("hide") : t("show")}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("delete", { question: p.question })}
              onClick={() => rpc({ op: "polls.delete", pollId: p.id })}
            >
              ✕
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
