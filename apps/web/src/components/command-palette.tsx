"use client";

import { Modal } from "@ronde/ui/modal";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { matchesWords } from "@/lib/shared/search";
import type { ControlPane } from "./control-room-tour";
import { useRonde } from "./ronde-provider";

// Control room: ⌘K (Ctrl+K) opens a command palette, "?" the list of keyboard shortcuts

interface Command {
  id: string;
  label: string;
  group: string;
  /** Keyboard shortcut shown next to it */
  keys?: string;
  run: () => void;
}

/** Every word typed appears in the label or the group */
const matches = (c: Command, q: string) => matchesWords(`${c.label} ${c.group}`, q);
const isTyping = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable]");

export function useControlShortcuts() {
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setHelp(false);
        setPalette((x) => !x);
      } else if (e.key === "?" && !isTyping(e) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setPalette(false);
        setHelp((x) => !x);
      }
    };
    window.addEventListener("keydown", onKey);
    // The workspace search leaves ⌘K to the control room
    document.documentElement.dataset.ownPalette = "1";
    return () => {
      window.removeEventListener("keydown", onKey);
      delete document.documentElement.dataset.ownPalette;
    };
  }, []);
  return { palette, setPalette, help, setHelp };
}

export function CommandPalette({ onClose, onPane }: { onClose: () => void; onPane: (p: ControlPane) => void }) {
  const t = useTranslations("palette");
  const { s, agenda, cur, rpc } = useRonde();
  const router = useRouter();
  const listId = useId();
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const m = s.meeting;
  const started = !!m?.startedAt;
  const path = s.context.path;

  const commands = useMemo((): Command[] => {
    const out: Command[] = [];
    const g = {
      meeting: t("groups.meeting"),
      steps: t("groups.steps"),
      panes: t("groups.panes"),
      people: t("groups.people"),
      pages: t("groups.pages"),
    };
    if (m) {
      out.push({
        id: "play",
        group: g.meeting,
        keys: t("keys.space"),
        label: !started ? t("start") : m.timer.running ? t("pause") : t("resume"),
        run: () => void rpc({ op: "meeting.togglePlay" }),
      });
      if (started) {
        out.push(
          {
            id: "next",
            group: g.meeting,
            keys: "→",
            label: t("next"),
            run: () => void rpc({ op: "meeting.step", delta: 1, from: m.stepKey }),
          },
          {
            id: "prev",
            group: g.meeting,
            keys: "←",
            label: t("previous"),
            run: () => void rpc({ op: "meeting.step", delta: -1, from: m.stepKey }),
          },
          { id: "bonus", group: g.meeting, label: t("bonus"), run: () => void rpc({ op: "meeting.bonus" }) },
          { id: "reset", group: g.meeting, label: t("resetTimer"), run: () => void rpc({ op: "meeting.resetTimer" }) },
        );
        for (const [i, step] of agenda.entries())
          if (i !== cur)
            out.push({
              id: `go:${step.key}`,
              group: g.steps,
              label: step.label,
              run: () => void rpc({ op: "meeting.goto", key: step.key }),
            });
      }
      out.push({ id: "shuffle", group: g.meeting, label: t("shuffle"), run: () => void rpc({ op: "meeting.shuffle" }) });
      for (const p of s.members.filter((x) => x.active))
        out.push({
          id: `absent:${p.id}`,
          group: g.people,
          label: m.absent.includes(p.id) ? t("present", { name: p.name }) : t("absent", { name: p.name }),
          run: () => void rpc({ op: "meeting.absent", id: p.id }),
        });
    }
    const panes: ControlPane[] = ["run", "live", "actions", "topics"];
    if (s.projects.length) panes.push("sheets");
    if (s.modules.polls) panes.push("polls");
    if (s.modules.random) panes.push("random");
    for (const pane of [...panes, "minutes"] as const)
      out.push({ id: `pane:${pane}`, group: g.panes, label: t(`panes.${pane}`), run: () => onPane(pane) });
    out.push(
      { id: "screen", group: g.pages, label: t("pages.screen"), run: () => window.open(`${path}/screen`, "ronde-screen") },
      { id: "remote", group: g.pages, label: t("pages.remote"), run: () => router.push(`${path}/remote`) },
      { id: "history", group: g.pages, label: t("pages.history"), run: () => router.push(`${path}/history`) },
      { id: "stats", group: g.pages, label: t("pages.stats"), run: () => router.push(`${path}/stats`) },
    );
    if (s.viewer.isAdmin)
      out.push({ id: "settings", group: g.pages, label: t("pages.settings"), run: () => router.push(`${path}/settings`) });
    return out;
  }, [t, m, started, agenda, cur, rpc, s.members, s.modules, s.viewer.isAdmin, path, router, onPane]);

  const shown = q.trim() ? commands.filter((c) => matches(c, q)) : commands;
  const index = Math.min(active, Math.max(0, shown.length - 1));
  const choose = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [index, listId]);

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <div className="palette">
        <h2 id={titleId} className="sr-only">
          {t("title")}
        </h2>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown.length ? `${listId}-${index}` : undefined}
          aria-label={t("title")}
          placeholder={t("placeholder")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((index + 1) % Math.max(1, shown.length));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((index - 1 + shown.length) % Math.max(1, shown.length));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(shown[index]);
            }
          }}
        />
        <ul id={listId} role="listbox" aria-label={t("title")} className="palette-list">
          {shown.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === index}
              className={i === index ? "on" : ""}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(c)}
            >
              <span className="palette-group">{c.group}</span>
              <span className="palette-label">{c.label}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </li>
          ))}
          {!shown.length && <li className="palette-empty">{t("none", { query: q.trim() })}</li>}
        </ul>
        <p className="hint palette-foot">{t("foot")}</p>
      </div>
    </Modal>
  );
}

/** Keyboard shortcuts of the control room */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const t = useTranslations("palette");
  const titleId = useId();
  const rows: [string, string][] = [
    ["→", t("help.next")],
    ["←", t("help.previous")],
    [t("keys.space"), t("help.timer")],
    ["⌘K / Ctrl+K", t("help.palette")],
    ["?", t("help.help")],
    ["Esc", t("help.close")],
  ];
  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} style={{ marginTop: 0 }}>
        {t("help.title")}
      </h2>
      <table className="shortcuts">
        <tbody>
          {rows.map(([k, label]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="controls">
        <span className="sep" />
        <button type="button" className="btn" onClick={onClose}>
          {t("help.ok")}
        </button>
      </div>
    </Modal>
  );
}
