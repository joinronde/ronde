"use client";

import { markdownToHtml } from "@ronde/core/markdown";
import type { Step } from "@ronde/core/meeting";
import { first } from "@ronde/core/util";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Select } from "@/components/select";
import { actionOwners } from "@/lib/shared/sheets";
import { actionsToReview, decidedAt, itemsOf, postableSlides, slideOf } from "@/lib/shared/slides";
import { useRonde } from "./ronde-provider";
import { Avatar, StatusPill, Timer } from "./stage";

/** A slide on the shared screen: its title and text, then what it is for (the irritants raised, the actions to review) */
export function SlideStage({ step, live }: { step: Step; live: boolean }) {
  const t = useTranslations("slides");
  const { s, nameOf } = useRonde();
  const slide = slideOf(s.settings.agenda, step.blockId);
  if (!slide) return null;
  const items = itemsOf(s.slideItems, slide.id);
  const review = slide.kind === "actions" ? actionsToReview(s.actions) : [];
  const decided = s.meeting ? decidedAt(s.actions, step.key, s.meeting.date) : [];
  return (
    <div className="slide-stage">
      <div className="slide-head">
        <h2>{step.label}</h2>
        {live && step.limitMs && <Timer stepKey={step.key} live />}
      </div>
      {slide.body?.trim() && <div className="md slide-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(slide.body) }} />}
      {slide.kind === "irritants" &&
        (items.length ? (
          <ul className="slide-items" aria-label={t("stage.items")}>
            {items.map((i) => (
              <li key={i.id} className={i.actionId ? "tracked" : undefined}>
                {i.authorId && <Avatar id={i.authorId} sm />}
                <span className="slide-item-text">{i.text}</span>
                {i.authorId && <span className="sr-only">{nameOf(i.authorId)}</span>}
                {i.actionId && <span className="pill done">{t("stage.tracked")}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint slide-empty">{t("stage.emptyIrritants")}</p>
        ))}
      {slide.kind === "irritants" && slide.anonymous && <p className="hint">{t("stage.anonymous")}</p>}
      {slide.kind === "actions" &&
        (review.length ? (
          <ul className="lineup slide-review" aria-label={t("stage.review", { count: review.length })}>
            {review.map((a) => (
              <li key={a.id}>
                <Avatar id={a.ownerId} sm />
                <span className="act-tx">
                  {a.text}
                  {a.progress && <span className="act-prog">{a.progress}</span>}
                </span>
                <span className="proj">
                  <StatusPill status={a.status} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint slide-empty">{t("stage.noActions")}</p>
        ))}
      {decided.length > 0 && (
        <div className="slide-decided">
          <div className="eyebrow sub-h">{t("stage.decided", { count: decided.length })}</div>
          <ul className="lineup">
            {decided.map((a) => (
              <li key={a.id}>
                <Avatar id={a.ownerId} sm />
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * "My screen": raise irritants on the slides still to come or running, before the meeting starts too, so they are
 * dealt with at their place and not in the middle of someone's turn
 */
export function SlidePanel() {
  const t = useTranslations("slides");
  const { s, rpc, agenda, cur } = useRonde();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const m = s.meeting;
  if (!m || m.endedAt || !s.viewer.memberId) return null;
  const open = postableSlides(s.settings.agenda).filter((b) => {
    const at = agenda.findIndex((x) => x.key === b.id);
    return at >= 0 && (!m.startedAt || at >= cur);
  });
  if (!open.length) return null;
  return (
    <>
      {open.map((b) => {
        const mine = s.slideItems.filter((i) => i.blockId === b.id && i.mine);
        const add = async (e: React.FormEvent) => {
          e.preventDefault();
          const text = drafts[b.id]?.trim();
          if (text && (await rpc({ op: "slide.item.add", blockId: b.id, text }))) setDrafts((d) => ({ ...d, [b.id]: "" }));
        };
        return (
          <section key={b.id} className="panel slide-panel" aria-labelledby={`slide-${b.id}`}>
            <h2 id={`slide-${b.id}`}>{b.title}</h2>
            <p className="hint">
              {t("me.hint")}
              {b.anonymous && ` ${t("me.anonymous")}`}
            </p>
            <form className="controls" onSubmit={add}>
              <label htmlFor={`slide-new-${b.id}`} className="sr-only">
                {t("me.placeholder")}
              </label>
              <input
                id={`slide-new-${b.id}`}
                type="text"
                maxLength={300}
                value={drafts[b.id] ?? ""}
                placeholder={t("me.placeholder")}
                onChange={(e) => setDrafts((d) => ({ ...d, [b.id]: e.target.value }))}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button type="submit" className="btn primary">
                {t("me.add")}
              </button>
            </form>
            {mine.length > 0 && (
              <ul className="slide-mine" aria-label={t("me.mine")}>
                {mine.map((i) => (
                  <li key={i.id}>
                    <span>{i.text}</span>
                    {i.actionId ? (
                      <span className="pill done">{t("stage.tracked")}</span>
                    ) : (
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label={t("me.remove", { text: i.text })}
                        onClick={() => rpc({ op: "slide.item.delete", id: i.id })}
                      >
                        <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

/** Control room, on an irritants slide: turn what was raised into actions, or remove it */
export function SlideHost({ step }: { step: Step }) {
  const t = useTranslations("slides");
  const { s, rpc } = useRonde();
  const owners = actionOwners(s);
  const [owner, setOwner] = useState<Record<string, string>>({});
  const slide = slideOf(s.settings.agenda, step.blockId);
  if (slide?.kind !== "irritants") return null;
  const items = itemsOf(s.slideItems, slide.id);
  // Its author owns it by default, when they can own an action
  const ownerOf = (i: (typeof items)[number]) =>
    owner[i.id] ?? (i.authorId && owners.some((o) => o.id === i.authorId) ? i.authorId : (owners[0]?.id ?? ""));
  return (
    <div className="slide-host">
      <p className="hint" role="status">
        {items.length ? t("host.count", { count: items.length }) : t("host.empty")}
      </p>
      {items.length > 0 && (
        <ul className="slide-host-list">
          {items.map((i) => (
            <li key={i.id}>
              <span className="slide-item-text">{i.text}</span>
              {i.actionId ? (
                <span className="pill done">{t("stage.tracked")}</span>
              ) : (
                <span className="controls">
                  <Select
                    aria-label={t("host.owner")}
                    value={ownerOf(i)}
                    onChange={(e) => setOwner((o) => ({ ...o, [i.id]: e.target.value }))}
                    style={{ width: "auto" }}
                  >
                    {owners.map((x) => (
                      <option key={x.id} value={x.id}>
                        {first(x.name)}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    className="btn"
                    disabled={!ownerOf(i)}
                    onClick={() => rpc({ op: "slide.item.toAction", id: i.id, ownerId: ownerOf(i) }, t("host.created"))}
                  >
                    {t("host.toAction")}
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={t("me.remove", { text: i.text })}
                    onClick={() => rpc({ op: "slide.item.delete", id: i.id })}
                  >
                    <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
