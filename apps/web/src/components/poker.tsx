"use client";

import type { PokerDTO } from "@ronde/core/types";
import { first } from "@ronde/core/util";
import { formatters } from "@ronde/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRonde } from "./ronde-provider";

// Planning poker: the team estimates items with cards kept hidden until the host reveals them

type Item = PokerDTO["items"][number];

/** The item being estimated: the first one without an estimate */
export const currentItem = (p: PokerDTO): Item | undefined => p.items.find((i) => i.final === null) ?? p.items[p.items.length - 1];

/** Average of the numeric cards, null without any */
function average(votes: { value: string }[]): number | null {
  const n = votes.map((v) => Number(v.value)).filter((x) => Number.isFinite(x));
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
}

/** Shared screen: the item, then everyone's card once revealed */
export function PokerStage() {
  const t = useTranslations("poker");
  const fmt = formatters(useLocale());
  const { s, nameOf } = useRonde();
  const p = s.poker;
  const item = p && currentItem(p);
  if (!p || !item) return <p className="hint">{t("noItems")}</p>;
  const avg = average(item.votes);
  return (
    <div className="poker-stage">
      <p className="retro-lead">{t("progress", { done: p.items.filter((i) => i.final).length, total: p.items.length })}</p>
      <h3>{item.title}</h3>
      {item.revealed ? (
        <>
          <ul className="poker-table">
            {item.votes.map((v) => (
              <li key={v.personId}>
                <span className="poker-card on">{v.value}</span>
                <span className="hint">{first(nameOf(v.personId))}</span>
              </li>
            ))}
          </ul>
          {avg !== null && <p className="retro-lead">{t("average", { value: fmt.decimal(avg) })}</p>}
        </>
      ) : (
        <p className="retro-count">{t("voted", { count: item.voted })}</p>
      )}
      {item.final && <p className="poker-final">{t("final", { value: item.final })}</p>}
    </div>
  );
}

/** "My screen": pick a card for the current item */
export function PokerPanel() {
  const t = useTranslations("poker");
  const { s, rpc } = useRonde();
  const p = s.poker;
  const item = p && currentItem(p);
  if (!p?.live || !item || item.revealed || item.final || !s.viewer.memberId) return null;
  return (
    <section className="panel retro-panel" aria-labelledby="poker-pick">
      <h2 id="poker-pick">{t("pickTitle", { title: item.title })}</h2>
      <div className="poker-deck" role="radiogroup" aria-label={t("deck")}>
        {p.deck.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={item.myVote === v}
            className={`poker-card${item.myVote === v ? " on" : ""}`}
            onClick={() => rpc({ op: "poker.vote", itemId: item.id, value: v })}
          >
            {v}
          </button>
        ))}
      </div>
      <p className="hint">{t("hidden")}</p>
    </section>
  );
}

/** Control room: the items to estimate, the reveal and the estimate agreed */
export function PokerHost() {
  const t = useTranslations("poker");
  const { s, rpc, members } = useRonde();
  const [title, setTitle] = useState("");
  const p = s.poker;
  if (!p) return null;
  const item = currentItem(p);
  const people = Object.values(members).filter((m) => m.active && m.role !== "observer").length;
  return (
    <div className="retro-host">
      {item && !item.final && (
        <div className="poker-controls" role="status">
          <strong>{item.title}</strong>
          <span className="hint">{t("votedOf", { count: item.voted, total: people })}</span>
          {!item.revealed ? (
            <button
              type="button"
              className="btn primary"
              disabled={!item.voted}
              onClick={() => rpc({ op: "poker.reveal", itemId: item.id })}
            >
              {t("reveal")}
            </button>
          ) : (
            <>
              <span className="hint">{t("agree")}</span>
              <div className="poker-deck small">
                {p.deck
                  .filter((v) => v !== "?" && v !== "☕")
                  .map((v) => (
                    <button
                      key={v}
                      type="button"
                      className="poker-card"
                      onClick={() => rpc({ op: "poker.final", itemId: item.id, value: v })}
                    >
                      {v}
                    </button>
                  ))}
              </div>
              <button type="button" className="btn" onClick={() => rpc({ op: "poker.revote", itemId: item.id })}>
                {t("revote")}
              </button>
            </>
          )}
        </div>
      )}
      <ol className="poker-items">
        {p.items.map((i) => (
          <li key={i.id} className={i.id === item?.id && !i.final ? "on" : ""}>
            <span>{i.title}</span>
            {i.final ? <span className="st-pill st-done">{i.final}</span> : null}
            {i.final && (
              <button
                type="button"
                className="icon-btn"
                aria-label={t("reopen", { title: i.title })}
                onClick={() => rpc({ op: "poker.revote", itemId: i.id })}
              >
                ↺
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={t("remove", { title: i.title })}
              onClick={() => rpc({ op: "poker.item.remove", id: i.id })}
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
      <form
        className="retro-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (title.trim() && (await rpc({ op: "poker.item.add", title: title.trim() }))) setTitle("");
        }}
      >
        <input
          aria-label={t("newItem")}
          placeholder={t("newItemPlaceholder")}
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!title.trim()}>
          {t("add")}
        </button>
      </form>
    </div>
  );
}
