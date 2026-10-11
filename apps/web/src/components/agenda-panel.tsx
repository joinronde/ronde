"use client";

import { type AgendaBlock, BLOCK_MODULE, type BlockType, PROJECT_ROUND_ORDERS, SINGLE_BLOCKS } from "@ronde/core/agenda";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/select";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";
import { BLOCK_ICON } from "./stage";

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
const ADDABLE: BlockType[] = ["intro", "round", "projects", "topics", "timebox", "retro", "poker"];

/** Blocks of the agenda, in order: core ones and module ones; saved by itself a moment after the last change */
export function AgendaPanel() {
  const t = useTranslations("agendaEditor");
  const { s, rpc } = useRonde();
  const saved = JSON.stringify(s.settings.agenda);
  const [blocks, setBlocks] = useState<AgendaBlock[]>(s.settings.agenda);
  const form = useRef<HTMLFormElement>(null);
  // What this panel sent last: when it comes back saved, what is on screen may already be newer
  const sent = useRef<string | null>(null);
  // The saved agenda changed elsewhere: start again from it
  useEffect(() => {
    if (saved !== sent.current) setBlocks(JSON.parse(saved) as AgendaBlock[]);
  }, [saved]);
  const dirty = JSON.stringify(blocks) !== saved;
  const running = !!s.meeting?.startedAt && !s.meeting.endedAt;
  const save = () => {
    if (!dirty || running || !form.current?.checkValidity()) return;
    sent.current = JSON.stringify(blocks);
    void rpc({ op: "agenda.save", blocks });
  };
  useEffect(() => {
    const timer = setTimeout(save, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(blocks), dirty, running]);
  const labelOf = (b: AgendaBlock) => (b.type === "timebox" ? b.title : t(`blocks.${b.type}`));
  const moduleOn = (type: BlockType) => !BLOCK_MODULE[type] || !!s.modules[BLOCK_MODULE[type]!];
  const canAdd = (type: BlockType) => moduleOn(type) && !(SINGLE_BLOCKS.includes(type) && blocks.some((b) => b.type === type));
  const move = (i: number, d: -1 | 1) =>
    setBlocks((list) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return next;
    });
  const patch = (i: number, p: Partial<Extract<AgendaBlock, { type: "timebox" }>>) =>
    setBlocks((list) => list.map((b, j) => (j === i && b.type === "timebox" ? { ...b, ...p } : b)));
  const patchProjects = (i: number, p: Partial<Extract<AgendaBlock, { type: "projects" }>>) =>
    setBlocks((list) => list.map((b, j) => (j === i && b.type === "projects" ? { ...b, ...p } : b)));
  const add = (type: BlockType) =>
    setBlocks((list): AgendaBlock[] => [
      ...list,
      type === "timebox"
        ? { id: newId(), type, title: t("newTimebox"), minutes: 10 }
        : type === "projects"
          ? { id: "projects", type, order: "manual" }
          : { id: type === "retro" ? "retro" : newId(), type: type as Exclude<BlockType, "timebox" | "projects"> },
    ]);
  return (
    <form
      className="panel form"
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3 style={{ margin: 0 }}>{t("title")}</h3>
      <p className="hint" style={{ margin: 0 }}>
        {t("intro")}
      </p>
      {running && <div className="note-box">{t("locked")}</div>}
      <ol className="agenda-blocks">
        {blocks.map((b, i) => (
          <li key={b.id} className={moduleOn(b.type) ? "" : "off"}>
            <span className="agenda-icon" aria-hidden="true">
              {BLOCK_ICON[b.type] && <Icon name={BLOCK_ICON[b.type]} size={16} />}
            </span>
            {b.type === "timebox" ? (
              <span className="agenda-timebox">
                <input
                  aria-label={t("timeboxTitle")}
                  value={b.title}
                  maxLength={80}
                  required
                  onChange={(e) => patch(i, { title: e.target.value })}
                />
                <input
                  type="number"
                  aria-label={t("minutes")}
                  min={1}
                  max={120}
                  value={b.minutes}
                  onChange={(e) => patch(i, { minutes: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })}
                />
                <span className="hint">{t("minutes")}</span>
              </span>
            ) : b.type === "projects" ? (
              <span className="agenda-timebox agenda-projects">
                <span className="agenda-label">
                  {labelOf(b)}
                  {!s.projects.length && <span className="hint"> · {t("noProjects")}</span>}
                </span>
                <Select
                  aria-label={t("projectOrder")}
                  value={b.order}
                  onChange={(e) => patchProjects(i, { order: e.target.value as (typeof PROJECT_ROUND_ORDERS)[number] })}
                  style={{ width: "auto" }}
                >
                  {PROJECT_ROUND_ORDERS.map((o) => (
                    <option key={o} value={o}>
                      {t(`projectOrders.${o}`)}
                    </option>
                  ))}
                </Select>
                <input
                  type="number"
                  aria-label={t("perProject")}
                  placeholder={t("perProjectAuto")}
                  min={1}
                  max={60}
                  value={b.perProjectSec ? Math.round(b.perProjectSec / 60) : ""}
                  onChange={(e) =>
                    patchProjects(i, {
                      perProjectSec: e.target.value ? Math.max(1, Math.min(60, Number(e.target.value) || 1)) * 60 : undefined,
                    })
                  }
                />
                <span className="hint">{t("perProject")}</span>
              </span>
            ) : (
              <span className="agenda-label">
                {labelOf(b)}
                {!moduleOn(b.type) && <span className="hint"> · {t("turnOn")}</span>}
              </span>
            )}
            <span className="controls">
              <button
                type="button"
                className="icon-btn"
                disabled={i === 0}
                aria-label={t("up", { label: labelOf(b) })}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={i === blocks.length - 1}
                aria-label={t("down", { label: labelOf(b) })}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={blocks.length === 1}
                aria-label={t("remove", { label: labelOf(b) })}
                onClick={() => setBlocks((list) => list.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="controls">
        <label className="sr-only" htmlFor="agendaAdd">
          {t("add")}
        </label>
        <Select
          id="agendaAdd"
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value as BlockType);
          }}
          style={{ width: "auto" }}
        >
          <option value="">+ {t("add")}</option>
          {ADDABLE.filter(canAdd).map((type) => (
            <option key={type} value={type}>
              {t(`blocks.${type}`)}
            </option>
          ))}
        </Select>
        <span className="hint save-status" role="status">
          {!dirty && sent.current === saved ? `✓ ${t("saved")}` : ""}
        </span>
      </div>
    </form>
  );
}

/** Retro settings: columns, votes and the time of each phase */
export function RetroSettings() {
  const t = useTranslations("retro.settings");
  const { s, rpc } = useRonde();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    preset: "well-improve-ideas",
    columns: "",
    votesPerPerson: 3,
    reflectMinutes: 7,
    voteMinutes: 3,
    discussMinutes: 5,
  });
  if (!s.modules.retro) return null;
  const presets = ["well-improve-ideas", "start-stop-continue", "4l", "mad-sad-glad", "custom"] as const;
  return (
    <form
      className="panel form"
      onSubmit={async (e) => {
        e.preventDefault();
        const columns = v.columns
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 6)
          .map((label, i) => ({ key: `c${i + 1}`, label }));
        if (
          await rpc(
            {
              op: "retro.configure",
              preset: v.preset as (typeof presets)[number],
              columns,
              votesPerPerson: v.votesPerPerson,
              reflectMinutes: v.reflectMinutes,
              voteMinutes: v.voteMinutes,
              discussMinutes: v.discussMinutes,
            },
            t("saved"),
          )
        )
          setOpen(false);
      }}
    >
      <h3 style={{ margin: 0 }}>{t("title")}</h3>
      {s.retro && <p className="hint">{s.retro.columns.map((c) => c.label).join(" · ")}</p>}
      {!open ? (
        <div>
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            {t("change")}
          </button>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="retroPreset">{t("preset")}</label>
            <Select id="retroPreset" value={v.preset} onChange={(e) => setV({ ...v, preset: e.target.value })}>
              {presets.map((p) => (
                <option key={p} value={p}>
                  {t(`presets.${p}`)}
                </option>
              ))}
            </Select>
          </div>
          {v.preset === "custom" && (
            <div className="field">
              <label htmlFor="retroColumns">{t("columns")}</label>
              <textarea id="retroColumns" required value={v.columns} onChange={(e) => setV({ ...v, columns: e.target.value })} />
            </div>
          )}
          <div className="grid2">
            {(
              [
                ["votesPerPerson", t("votes"), 1, 10],
                ["reflectMinutes", t("reflect"), 1, 30],
                ["voteMinutes", t("vote"), 1, 15],
                ["discussMinutes", t("discuss"), 1, 30],
              ] as const
            ).map(([k, label, min, max]) => (
              <div className="field" key={k}>
                <label htmlFor={`retro-${k}`}>{label}</label>
                <input
                  id={`retro-${k}`}
                  type="number"
                  min={min}
                  max={max}
                  value={v[k]}
                  onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
          <div>
            <button type="submit" className="btn primary">
              {t("save")}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

/** Planning poker settings: the deck of cards */
export function PokerSettings() {
  const t = useTranslations("poker");
  const { s, rpc } = useRonde();
  if (!s.modules.poker) return null;
  const current = s.poker?.deck.join(" ") ?? "";
  return (
    <div className="panel form">
      <h3 style={{ margin: 0 }}>{t("settingsTitle")}</h3>
      <div className="field">
        <label htmlFor="pokerDeck">{t("deck")}</label>
        <Select
          id="pokerDeck"
          value={current.startsWith("XS") ? "tshirt" : current.startsWith("1 2 4") ? "powers" : "fibonacci"}
          onChange={(e) => rpc({ op: "poker.configure", deck: e.target.value as "fibonacci" | "tshirt" | "powers" }, t("deckSaved"))}
        >
          {(["fibonacci", "tshirt", "powers"] as const).map((d) => (
            <option key={d} value={d}>
              {t(`decks.${d}`)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
