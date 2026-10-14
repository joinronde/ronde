"use client";

import * as Popover from "@radix-ui/react-popover";
import { ArrowUpRight, Check, CornerDownRight, Plus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  addJobCategoryAction,
  deleteJobCategoryAction,
  moveJobCategoryAction,
  renameJobCategoryAction,
  styleJobCategoryAction,
} from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { EmptyHero } from "@/components/illustration";
import { teamAndBelow, teamOptions } from "@/components/people-picker";
import { PersonFace } from "@/components/person-face";
import { Select } from "@/components/select";
import { TeamIcon } from "@/components/team-icon";
import { TEAM_ICONS } from "@/lib/shared/team-icons";
import { useConfirm } from "./confirm";
import { PeopleTabs } from "./people-tabs";

// The directory's teams as a tree: a department, its teams, their squads. Each shows its people (and how many with
// its sub-teams); administrators create, rename, recolour, move and delete them.

export interface TeamNode {
  id: string;
  name: string;
  color: number;
  icon?: string;
  parentId: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  color: number;
  avatar: number | null;
  teamId: string | null;
}

const PALETTE = [0, 1, 2, 3, 4, 5];

/** A team's badge, which opens its drawing and colour to pick */
function TeamStyle({
  team,
  onStyle,
  labels,
}: {
  team: TeamNode;
  onStyle: (style: { color?: number; icon?: string }) => void;
  labels: { title: string; icon: string; color: string; colorN: (n: number) => string };
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="team-swatch team-swatch-btn" aria-label={labels.title} title={labels.title}>
          <TeamIcon name={team.icon} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="team-style-pop" sideOffset={8} align="start" collisionPadding={12}>
          <p className="team-style-title">{labels.icon}</p>
          <div className="team-icons" role="group" aria-label={labels.icon}>
            {TEAM_ICONS.map((name) => (
              <button
                key={name}
                type="button"
                className="team-icon-opt"
                aria-pressed={(team.icon || "users") === name}
                aria-label={name}
                onClick={() => onStyle({ icon: name === "users" ? "" : name })}
              >
                <TeamIcon name={name} size={17} />
              </button>
            ))}
          </div>
          <p className="team-style-title">{labels.color}</p>
          <div className="team-colors" role="group" aria-label={labels.color}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className="team-color"
                aria-pressed={team.color % 6 === c}
                aria-label={labels.colorN(c + 1)}
                style={{ "--c": `var(--c${c})` } as React.CSSProperties}
                onClick={() => team.color % 6 !== c && onStyle({ color: c })}
              >
                {team.color % 6 === c && <Check size={12} strokeWidth={3} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TeamsBoard({
  slug,
  teams,
  people,
  canManage,
}: {
  slug: string;
  teams: TeamNode[];
  people: TeamMember[];
  canManage: boolean;
}) {
  const t = useTranslations("orgTeams");
  const router = useRouter();
  const [confirmDialog, confirm] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [addingUnder, setAddingUnder] = useState<string | null>(null);

  const done = (res: { ok: boolean; error?: string }) => {
    if (!res.ok) setError(res.error ?? null);
    else {
      setError(null);
      router.refresh();
    }
    return res.ok;
  };

  const ordered = useMemo(() => teamOptions(teams), [teams]);
  const without = people.filter((p) => !p.teamId || !teams.some((x) => x.id === p.teamId));

  const add = async (e: React.FormEvent, parentId: string | null) => {
    e.preventDefault();
    setBusy(true);
    if (done(await addJobCategoryAction(slug, name, parentId))) {
      setName("");
      setAddingUnder(null);
    }
    setBusy(false);
  };
  const parentOptions = (except: string | null) => {
    const below = except ? teamAndBelow(teams, except) : new Set<string>();
    return ordered.filter(({ team }) => !below.has(team.id));
  };

  const addForm = (parentId: string | null, autoFocus = false) => (
    <form className="team-add" onSubmit={(e) => void add(e, parentId ?? (parent || null))}>
      <input
        type="text"
        required
        maxLength={60}
        autoFocus={autoFocus}
        placeholder={t("namePlaceholder")}
        aria-label={t("namePlaceholder")}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {parentId === null && ordered.length > 0 && (
        <Select aria-label={t("parent")} className="compact" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">{t("top")}</option>
          {ordered.map(({ team, depth }) => (
            <option key={team.id} value={team.id}>
              {`${"  ".repeat(depth)}${depth ? "↳ " : ""}${team.name}`}
            </option>
          ))}
        </Select>
      )}
      <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
        <Plus size={16} strokeWidth={2.2} aria-hidden="true" /> {t("create")}
      </button>
      {parentId !== null && (
        <button type="button" className="btn ghost" onClick={() => setAddingUnder(null)}>
          {t("cancel")}
        </button>
      )}
    </form>
  );

  return (
    <div className="page teams-page">
      <PeopleTabs slug={slug} />
      <header className="page-head row">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("intro")}</p>
        </div>
      </header>
      <FormAlert>{error}</FormAlert>
      {canManage ? (
        <section className="panel team-new" aria-labelledby="team-new-title">
          <h2 id="team-new-title" className="team-new-title">
            <Plus size={18} strokeWidth={2.2} aria-hidden="true" /> {t("add")}
          </h2>
          {addingUnder === null && addForm(null)}
        </section>
      ) : (
        <p className="hint">{t("readOnly")}</p>
      )}
      {ordered.length === 0 ? (
        <EmptyHero art="people" title={t("empty")} hint={t("emptyHint")} />
      ) : (
        <ul className="team-tree">
          {ordered.map(({ team, depth }) => {
            const own = people.filter((p) => p.teamId === team.id);
            const all = people.filter((p) => p.teamId && teamAndBelow(teams, team.id).has(p.teamId));
            const subTeams = teams.filter((x) => x.parentId === team.id).length;
            return (
              <li
                key={team.id}
                className="team-node"
                style={{ "--depth": depth, "--c": `var(--c${team.color % 6})` } as React.CSSProperties}
              >
                {depth > 0 && <CornerDownRight className="team-branch" size={16} strokeWidth={2} aria-hidden="true" />}
                <div className="team-card">
                  {canManage ? (
                    <TeamStyle
                      team={team}
                      onStyle={async (style) => done(await styleJobCategoryAction(slug, team.id, style))}
                      labels={{
                        title: t("style", { name: team.name }),
                        icon: t("icon"),
                        color: t("colorTitle"),
                        colorN: (n) => t("colorN", { n }),
                      }}
                    />
                  ) : (
                    <span className="team-swatch" aria-hidden="true">
                      <TeamIcon name={team.icon} />
                    </span>
                  )}
                  <div className="team-main">
                    {canManage ? (
                      <input
                        type="text"
                        className="team-name-input"
                        defaultValue={team.name}
                        aria-label={t("rename", { name: team.name })}
                        onBlur={async (e) => {
                          const value = e.target.value.trim();
                          if (value === team.name) return;
                          if (!value || !done(await renameJobCategoryAction(slug, team.id, value))) e.target.value = team.name;
                        }}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      />
                    ) : (
                      <strong className="team-name">{team.name}</strong>
                    )}
                    <span className="team-meta">
                      {t("members", { count: own.length })}
                      {subTeams > 0 && (
                        <>
                          {" · "}
                          {t("subTeams", { count: subTeams })}
                          {" · "}
                          {t("withSub", { count: all.length })}
                        </>
                      )}
                    </span>
                  </div>
                  <div className="team-faces" aria-hidden="true">
                    {own.slice(0, 6).map((p) => (
                      <PersonFace key={p.id} slug={slug} person={p} title={p.name} />
                    ))}
                    {own.length > 6 && <span className="av sm team-more">+{own.length - 6}</span>}
                  </div>
                  <div className="team-actions">
                    {all.length > 0 && (
                      <Link href={`/w/${slug}/people?team=${team.id}`} className="btn ghost sm" title={t("seePeople")}>
                        <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
                        <span className="hide-sm">{t("seePeople")}</span>
                      </Link>
                    )}
                    {canManage && (
                      <>
                        <Select
                          className="compact team-parent"
                          aria-label={t("moveTo", { name: team.name })}
                          title={t("moveTo", { name: team.name })}
                          value={team.parentId ?? ""}
                          onChange={async (e) => done(await moveJobCategoryAction(slug, team.id, e.target.value || null))}
                        >
                          <option value="">{t("top")}</option>
                          {parentOptions(team.id).map(({ team: p, depth: d }) => (
                            <option key={p.id} value={p.id}>
                              {`${"  ".repeat(d)}${d ? "↳ " : ""}${p.name}`}
                            </option>
                          ))}
                        </Select>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t("addSub", { name: team.name })}
                          onClick={() => {
                            setName("");
                            setAddingUnder(team.id);
                          }}
                        >
                          <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          aria-label={t("delete", { name: team.name })}
                          onClick={async () => {
                            if (
                              await confirm({
                                message: t("deleteConfirm", { name: team.name }),
                                confirmLabel: t("deleteShort"),
                                danger: true,
                              })
                            )
                              done(await deleteJobCategoryAction(slug, team.id));
                          }}
                        >
                          <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {addingUnder === team.id && <div className="team-sub-form">{addForm(team.id, true)}</div>}
              </li>
            );
          })}
          {without.length > 0 && (
            <li className="team-node team-none">
              <div className="team-card">
                <span className="team-swatch" aria-hidden="true">
                  <Users size={18} strokeWidth={2} />
                </span>
                <div className="team-main">
                  <strong className="team-name">{t("noTeam")}</strong>
                  <span className="team-meta">{t("members", { count: without.length })}</span>
                </div>
                <div className="team-faces" aria-hidden="true">
                  {without.slice(0, 6).map((p) => (
                    <PersonFace key={p.id} slug={slug} person={p} title={p.name} />
                  ))}
                  {without.length > 6 && <span className="av sm team-more">+{without.length - 6}</span>}
                </div>
                <div className="team-actions">
                  <span className="hint">{t("noTeamHint")}</span>
                </div>
              </div>
            </li>
          )}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
