"use client";

import { ChevronRight, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { PersonFace } from "@/components/person-face";
import { TeamIcon } from "@/components/team-icon";
import { fold } from "@/lib/shared/search";
import { teamAndBelow, teamOptions, teamPath } from "@/lib/shared/teams";
import { Highlighted } from "./highlighted";

export { teamAndBelow, teamOptions, teamPath };

// People to pick, by team: a team's box picks everyone in it and in the teams under it, a search finds a person
// or a team by name. Teams are the directory's (a team may belong to another one).

export interface PickerPerson {
  id: string;
  name: string;
  email: string;
  color: number;
  avatar: number | null;
  teamId: string | null;
}

export interface PickerTeam {
  id: string;
  name: string;
  color: number;
  /** Its drawing (components/team-icon.tsx); empty: a group of people */
  icon?: string;
  parentId: string | null;
}

/** A person's team as a coloured chip, its parents before it in small */
export function TeamChip({ teams, id }: { teams: PickerTeam[]; id: string | null }) {
  const team = teams.find((x) => x.id === id);
  if (!team) return <span className="hint">—</span>;
  const path = teamPath(teams, team.id).split(" › ");
  return (
    <span className="team-chip" style={{ "--c": `var(--c${team.color % 6})` } as React.CSSProperties} title={path.join(" › ")}>
      <TeamIcon name={team.icon} size={13} />
      {path.length > 1 && <span className="team-chip-up">{path.slice(0, -1).join(" › ")} ›</span>}
      {team.name}
    </span>
  );
}

export function PeoplePicker({
  slug,
  people,
  teams,
  picked,
  onChange,
}: {
  slug: string;
  people: PickerPerson[];
  teams: PickerTeam[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const t = useTranslations("peoplePicker");
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const q = fold(query.trim());

  const ordered = useMemo(() => teamOptions(teams), [teams]);

  const membersOf = (teamId: string) => {
    const ids = teamAndBelow(teams, teamId);
    return people.filter((p) => p.teamId && ids.has(p.teamId));
  };
  const toggleMany = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    onChange(next);
  };
  const matches = (p: PickerPerson) => !q || fold(`${p.name} ${p.email} ${teamPath(teams, p.teamId)}`).includes(q);

  // Groups: each team with its own people (not those of its sub-teams, listed under them), then the people of no team
  const groups = [
    ...ordered.map(({ team, depth }) => ({
      id: team.id,
      team,
      depth,
      own: people.filter((p) => p.teamId === team.id && matches(p)),
      all: membersOf(team.id),
    })),
    {
      id: "",
      team: null,
      depth: 0,
      own: people.filter((p) => (!p.teamId || !teams.some((x) => x.id === p.teamId)) && matches(p)),
      all: people.filter((p) => !p.teamId || !teams.some((x) => x.id === p.teamId)),
    },
  ].filter((g) => g.own.length > 0 || (g.team && (!q || fold(g.team.name).includes(q)) && g.all.length > 0));
  const hiddenBy = (g: (typeof groups)[number]) => {
    for (let p = g.team?.parentId; p; p = teams.find((x) => x.id === p)?.parentId ?? null) if (folded.has(p)) return true;
    return false;
  };

  return (
    <div className="pp">
      <div className="pp-tools">
        <label className="search-input">
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={t("search")}
            aria-label={t("search")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="pp-count" aria-live="polite">
          {t("selected", { count: picked.size, total: people.length })}
        </span>
        <span className="controls">
          <button type="button" className="btn sm" onClick={() => onChange(new Set(people.map((p) => p.id)))}>
            {t("all")}
          </button>
          <button type="button" className="btn sm" onClick={() => onChange(new Set())}>
            {t("none")}
          </button>
        </span>
      </div>
      {teams.length > 0 && (
        <div className="pp-teams" role="group" aria-label={t("teams")}>
          {ordered
            .filter(({ depth }) => depth === 0 || ordered.length <= 12)
            .map(({ team, depth }) => {
              const all = membersOf(team.id);
              if (!all.length) return null;
              const on = all.every((p) => picked.has(p.id));
              return (
                <button
                  key={team.id}
                  type="button"
                  className="pp-team-chip"
                  aria-pressed={on}
                  style={{ "--c": `var(--c${team.color % 6})` } as React.CSSProperties}
                  title={t("pickTeam", { name: teamPath(teams, team.id), count: all.length })}
                  onClick={() =>
                    toggleMany(
                      all.map((p) => p.id),
                      !on,
                    )
                  }
                >
                  {depth > 0 && (
                    <span className="pp-sub" aria-hidden="true">
                      ↳
                    </span>
                  )}
                  <TeamIcon name={team.icon} size={14} />
                  <Highlighted text={team.name} query={query} anywhere />
                  <span className="pp-team-n">{all.length}</span>
                </button>
              );
            })}
        </div>
      )}
      <div className="pp-list">
        {groups.length === 0 && <p className="hint pp-empty">{t("noMatch")}</p>}
        {groups.map((g) => {
          if (hiddenBy(g)) return null;
          const all = g.all;
          const count = all.filter((p) => picked.has(p.id)).length;
          const state = count === 0 ? false : count === all.length ? true : "mixed";
          const isFolded = folded.has(g.id);
          const hasChildren = g.team && teams.some((x) => x.parentId === g.team!.id);
          return (
            <section key={g.id || "none"} className="pp-group" style={{ "--depth": g.depth } as React.CSSProperties}>
              <div className="pp-group-head">
                <button
                  type="button"
                  className="pp-fold"
                  aria-expanded={!isFolded}
                  aria-label={
                    isFolded ? t("unfold", { name: g.team?.name ?? t("noTeam") }) : t("fold", { name: g.team?.name ?? t("noTeam") })
                  }
                  onClick={() =>
                    setFolded((f) => {
                      const next = new Set(f);
                      next.has(g.id) ? next.delete(g.id) : next.add(g.id);
                      return next;
                    })
                  }
                >
                  <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" />
                </button>
                <label className="pp-group-check">
                  <input
                    type="checkbox"
                    checked={state === true}
                    ref={(el) => {
                      if (el) el.indeterminate = state === "mixed";
                    }}
                    onChange={() =>
                      toggleMany(
                        all.map((p) => p.id),
                        state !== true,
                      )
                    }
                  />
                  {g.team ? (
                    <span
                      className="pp-team-dot"
                      style={{ "--c": `var(--c${g.team.color % 6})` } as React.CSSProperties}
                      aria-hidden="true"
                    />
                  ) : null}
                  <strong>{g.team?.name ?? t("noTeam")}</strong>
                  <span className="hint">
                    {count}/{all.length}
                    {hasChildren ? ` · ${t("withSubTeams")}` : ""}
                  </span>
                </label>
              </div>
              {!isFolded && g.own.length > 0 && (
                <ul className="pick-list pp-people">
                  {g.own.map((p) => (
                    <li key={p.id}>
                      <label className={`pick${picked.has(p.id) ? " on" : ""}`}>
                        <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggleMany([p.id], !picked.has(p.id))} />
                        <PersonFace slug={slug} person={p} />
                        <span className="person-text">
                          <span className="person-name">
                            <Highlighted text={p.name} query={query} anywhere />
                          </span>
                          <span className="hint">
                            <Highlighted text={p.email} query={query} anywhere />
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
