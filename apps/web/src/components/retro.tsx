"use client";

import type { Step } from "@ronde/core/meeting";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { byVotes, titleOf } from "@/lib/shared/modules";
import { useRonde } from "./ronde-provider";
import { Timer } from "./stage";

// Retrospective: anonymous notes in columns, grouped by the host, voted on by the team, then discussed

/** Shared screen and stage preview: what the team sees at each phase */
export function RetroStage({ step, live }: { step: Step; live: boolean }) {
  const t = useTranslations("retro");
  const { s } = useRonde();
  const r = s.retro;
  if (!r) return null;
  const phase = step.sub?.split(":")[0];
  const discussed = step.sub?.startsWith("discuss:") ? r.groups.find((g) => g.id === step.sub!.slice(8)) : null;
  return (
    <div className={`retro-stage phase-${phase}`}>
      {phase === "reflect" && (
        <>
          <p className="retro-lead">{t("stage.reflect", { count: r.writers })}</p>
          <div className="retro-cols">
            {r.columns.map((c) => (
              <div key={c.key} className="retro-col" style={{ "--c": `var(--c${c.color})` } as React.CSSProperties}>
                <h3>{c.label}</h3>
                <p className="retro-count" key={r.counts[c.key]}>
                  {t("notes", { count: r.counts[c.key] ?? 0 })}
                </p>
              </div>
            ))}
          </div>
          {live && <Timer stepKey={step.key} live />}
        </>
      )}
      {(phase === "group" || phase === "vote") && (
        <div className="retro-cols">
          {r.columns.map((c) => {
            const groups = r.groups.filter((g) => g.column === c.key);
            const alone = r.cards.filter((x) => x.column === c.key && !x.groupId);
            return (
              <div key={c.key} className="retro-col" style={{ "--c": `var(--c${c.color})` } as React.CSSProperties}>
                <h3>{c.label}</h3>
                <ul className="retro-list">
                  {groups.map((g, i) => (
                    <li key={g.id} className="retro-group" style={{ "--i": i } as React.CSSProperties}>
                      <strong>{titleOf(g, r.cards)}</strong>
                      {phase === "vote" && <span className="retro-votes">{t("votes", { count: g.votes })}</span>}
                      <ul>
                        {r.cards
                          .filter((x) => x.groupId === g.id)
                          .map((x) => (
                            <li key={x.id}>{x.text}</li>
                          ))}
                      </ul>
                    </li>
                  ))}
                  {alone.map((x, i) => (
                    <li key={x.id} className="retro-card" style={{ "--i": groups.length + i } as React.CSSProperties}>
                      {x.text}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {phase === "vote" && <p className="retro-lead">{t("stage.vote", { count: r.voters })}</p>}
      {discussed && (
        <div className="retro-focus">
          <p className="retro-votes">{t("votes", { count: discussed.votes })}</p>
          <h3>{titleOf(discussed, r.cards)}</h3>
          <ul>
            {r.cards
              .filter((x) => x.groupId === discussed.id)
              .map((x) => (
                <li key={x.id}>{x.text}</li>
              ))}
          </ul>
          {live && <Timer stepKey={step.key} live />}
        </div>
      )}
      {phase === "done" && (
        <div className="retro-focus">
          <h3>{t("stage.done")}</h3>
          <ol>
            {r.groups
              .filter((g) => g.votes > 0)
              .sort(byVotes)
              .map((g) => (
                <li key={g.id}>
                  {titleOf(g, r.cards)} <span className="retro-votes">{t("votes", { count: g.votes })}</span>
                </li>
              ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** "My screen": write notes while the team writes, vote while it votes */
export function RetroPanel() {
  const t = useTranslations("retro");
  const { s, rpc } = useRonde();
  const r = s.retro;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  if (!r || (r.phase !== "reflect" && r.phase !== "vote") || !s.viewer.memberId) return null;
  if (r.phase === "reflect")
    return (
      <section className="panel retro-panel" aria-labelledby="retro-write">
        <h2 id="retro-write">{t("me.writeTitle")}</h2>
        <p className="hint">{t("me.writeHint")}</p>
        <div className="retro-cols">
          {r.columns.map((c) => {
            const mine = r.cards.filter((x) => x.column === c.key);
            const add = async (e: React.FormEvent) => {
              e.preventDefault();
              const text = drafts[c.key]?.trim();
              if (text && (await rpc({ op: "retro.card.add", column: c.key, text }))) setDrafts((d) => ({ ...d, [c.key]: "" }));
            };
            return (
              <div key={c.key} className="retro-col" style={{ "--c": `var(--c${c.color})` } as React.CSSProperties}>
                <h3>{c.label}</h3>
                <ul className="retro-list">
                  {mine.map((x) =>
                    editing?.id === x.id ? (
                      <li key={x.id} className="retro-card">
                        <form
                          className="retro-edit"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (await rpc({ op: "retro.card.update", id: x.id, text: editing.text })) setEditing(null);
                          }}
                        >
                          <input
                            aria-label={t("me.editNote")}
                            value={editing.text}
                            maxLength={500}
                            onChange={(e) => setEditing({ id: x.id, text: e.target.value })}
                          />
                          <button type="submit" className="btn sm">
                            {t("me.save")}
                          </button>
                        </form>
                      </li>
                    ) : (
                      <li key={x.id} className="retro-card mine">
                        <span>{x.text}</span>
                        <span className="controls">
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={t("me.edit", { text: x.text })}
                            onClick={() => setEditing({ id: x.id, text: x.text })}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            aria-label={t("me.delete", { text: x.text })}
                            onClick={() => rpc({ op: "retro.card.delete", id: x.id })}
                          >
                            <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                          </button>
                        </span>
                      </li>
                    ),
                  )}
                </ul>
                <form className="retro-add" onSubmit={add}>
                  <input
                    aria-label={t("me.addTo", { column: c.label })}
                    placeholder={t("me.placeholder")}
                    maxLength={500}
                    value={drafts[c.key] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.key]: e.target.value }))}
                  />
                  <button type="submit" className="btn sm" disabled={!drafts[c.key]?.trim()}>
                    {t("me.add")}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </section>
    );
  return (
    <section className="panel retro-panel" aria-labelledby="retro-vote">
      <h2 id="retro-vote">{t("me.voteTitle")}</h2>
      <p className="hint" role="status">
        {t("me.votesLeft", { count: r.myVotesLeft, total: r.votesPerPerson })}
      </p>
      <ul className="retro-vote-list">
        {[...r.groups]
          .sort((a, b) => a.position - b.position)
          .map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="vote-btn"
                aria-pressed={g.mine}
                disabled={!g.mine && r.myVotesLeft === 0}
                onClick={() => rpc({ op: "retro.vote", groupId: g.id })}
              >
                {g.mine ? "★" : "☆"} <span className="sr-only">{g.mine ? t("me.unvote") : t("me.vote")}</span>
              </button>
              <span>{titleOf(g, r.cards)}</span>
            </li>
          ))}
      </ul>
    </section>
  );
}

/** Control room: follow the writing, group the notes, name the groups, follow the vote */
export function RetroHost() {
  const t = useTranslations("retro");
  const { s, rpc, members } = useRonde();
  const r = s.retro;
  const [picked, setPicked] = useState<string | null>(null);
  if (!r || !r.phase) return null;
  const people = Object.values(members).filter((p) => p.active && p.role !== "observer").length;
  if (r.phase === "reflect")
    return (
      <div className="retro-host" role="status">
        <strong>{t("host.writers", { count: r.writers, total: people })}</strong>
        <span className="hint">{r.columns.map((c) => `${c.label} : ${r.counts[c.key] ?? 0}`).join(" · ")}</span>
        <span className="hint">{t("host.revealHint")}</span>
      </div>
    );
  if (r.phase === "vote")
    return (
      <div className="retro-host" role="status">
        <strong>{t("host.voters", { count: r.voters, total: people })}</strong>
        <span className="hint">{t("host.voteHint")}</span>
      </div>
    );
  if (r.phase !== "group") return null;
  const pick = (id: string) => {
    if (!picked) return setPicked(id);
    if (picked !== id) void rpc({ op: "retro.group", cardId: picked, targetCardId: id });
    setPicked(null);
  };
  return (
    <div className="retro-host">
      <p className="hint" role="status">
        {picked ? t("host.pickTarget") : t("host.groupHint")}
      </p>
      <div className="retro-cols">
        {r.columns.map((c) => (
          <div key={c.key} className="retro-col" style={{ "--c": `var(--c${c.color})` } as React.CSSProperties}>
            <h3>{c.label}</h3>
            <ul className="retro-list">
              {r.groups
                .filter((g) => g.column === c.key)
                .map((g) => (
                  <li key={g.id} className="retro-group">
                    <input
                      aria-label={t("host.rename")}
                      defaultValue={g.title}
                      placeholder={titleOf(g, r.cards)}
                      maxLength={120}
                      onBlur={(e) => e.target.value !== g.title && rpc({ op: "retro.group.rename", id: g.id, title: e.target.value })}
                    />
                    <ul>
                      {r.cards
                        .filter((x) => x.groupId === g.id)
                        .map((x) => (
                          <li key={x.id} className="retro-card">
                            <button
                              type="button"
                              className={`retro-pick${picked === x.id ? " on" : ""}`}
                              aria-pressed={picked === x.id}
                              onClick={() => pick(x.id)}
                            >
                              {x.text}
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={t("host.ungroup", { text: x.text })}
                              onClick={() => rpc({ op: "retro.ungroup", cardId: x.id })}
                            >
                              ⤴
                            </button>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              {r.cards
                .filter((x) => x.column === c.key && !x.groupId)
                .map((x) => (
                  <li key={x.id} className="retro-card">
                    <button
                      type="button"
                      className={`retro-pick${picked === x.id ? " on" : ""}`}
                      aria-pressed={picked === x.id}
                      onClick={() => pick(x.id)}
                    >
                      {x.text}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
