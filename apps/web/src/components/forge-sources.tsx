"use client";

import type { ForgeConnectionView, GithubSource, GitlabProject, GitlabSource } from "@ronde/core/types";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ConnectionDetails, ConnectionName, ConnectWithGitlab, ForgeConnectionForm, useConnectionLabel } from "./forge-connections";
import { useRonde } from "./ronde-provider";
import { useConfirm } from "./workspace/confirm";

type ConfirmFn = ReturnType<typeof useConfirm>[1];

// The GitLab or GitHub connections a meeting reads each person's issues through: the workspace's, the instance's
// and its own, each ticked or not with its filters (GitLab groups and followed projects, GitHub repositories),
// and a connection of its own added here

type Kind = ForgeConnectionView["kind"];
type Source = GitlabSource | GithubSource;

const blank = (kind: Kind, connection: string): Source =>
  kind === "gitlab" ? { connection, groups: "", projects: "" } : { connection, repos: "" };

export function ForgeSources({ kind }: { kind: Kind }) {
  const t = useTranslations("forges");
  const label = useConnectionLabel();
  const { s, rpc } = useRonde();
  const [confirmDialog, confirm] = useConfirm();
  const forges = s.settings.forges;
  const saved = forges[kind].sources as Source[];
  const connections = forges.connections.filter((c) => c.kind === kind);
  const [sources, setSources] = useState<Source[]>(saved);
  const [adding, setAdding] = useState(false);
  // The saved list comes back from the server (after a save, or another host's)
  const savedSig = JSON.stringify(saved);
  useEffect(() => setSources(JSON.parse(savedSig) as Source[]), [savedSig]);
  const kindName = t(`kinds.${kind}`);

  const toggle = (id: string, on: boolean) =>
    setSources((list) =>
      on ? [...list, saved.find((x) => x.connection === id) ?? blank(kind, id)] : list.filter((x) => x.connection !== id),
    );
  const patch = (id: string, change: Partial<GitlabSource & GithubSource>) =>
    setSources((list) => list.map((x) => (x.connection === id ? ({ ...x, ...change } as Source) : x)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kind === "gitlab") await rpc({ op: "gitlab.configure", sources: sources as GitlabSource[] }, t("saved"));
    else await rpc({ op: "github.configure", sources: sources as GithubSource[] }, t("saved"));
  };

  return (
    <>
      <form className="panel form forge-sources" onSubmit={save}>
        <h3 style={{ margin: 0 }}>{t("meeting.title", { kind: kindName })}</h3>
        <p className="hint" style={{ margin: 0 }}>
          {forges[kind].picked ? t("meeting.picked") : t("meeting.inherited")}
        </p>
        {!connections.length && <div className="note-box">{t("meeting.none", { kind: kindName })}</div>}
        <ul className="forge-source-list">
          {connections.map((c) => {
            const source = sources.find((x) => x.connection === c.id);
            return (
              <li key={c.id} className={`forge-source${source ? " on" : ""}`}>
                <div className="forge-source-head">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!source}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                      aria-label={`${t("meeting.use")} ${label(c)}`}
                    />{" "}
                    <ConnectionName c={c} />
                  </label>
                  <ConnectionDetails c={c} />
                  {c.scope === "meeting" && <OwnActions c={c} confirm={confirm} />}
                </div>
                {source && "groups" in source && (
                  <GitlabFilters
                    c={c}
                    source={source}
                    saved={saved.find((x) => x.connection === c.id) as GitlabSource | undefined}
                    onChange={(v) => patch(c.id, v)}
                  />
                )}
                {source && "repos" in source && (
                  <div className="field">
                    <label htmlFor={`gRepos-${c.id}`}>{t("meeting.repos")}</label>
                    <textarea
                      id={`gRepos-${c.id}`}
                      value={source.repos}
                      onChange={(e) => patch(c.id, { repos: e.target.value })}
                      placeholder={"my-org\nmy-org/api"}
                    />
                    <span className="hint">{t("meeting.reposHint")}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {connections.length > 0 && (
          <div>
            <button type="submit" className="btn primary">
              {t("meeting.save", { kind: kindName })}
            </button>
          </div>
        )}
      </form>
      <div className="panel form forge-own">
        {adding ? (
          <ForgeConnectionForm
            connection={null}
            kinds={[kind]}
            servers={forges.servers}
            canEncrypt={s.integrations.secrets}
            oauth={
              kind === "gitlab" &&
              s.integrations.gitlabOAuth && <ConnectWithGitlab slug={s.context.workspace.slug} meetingId={s.context.meetingId} />
            }
            onSubmit={async (d) => {
              const ok = await rpc({ op: "forge.add", kind, name: d.name, url: d.url, token: d.token }, t("saved"));
              if (ok) setAdding(false);
              return ok;
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <>
            <div>
              <button type="button" className="btn" onClick={() => setAdding(true)}>
                {t("addOwn")}
              </button>
            </div>
            <span className="hint">{t("addOwnHint")}</span>
          </>
        )}
      </div>
      {confirmDialog}
    </>
  );
}

/** Test, connect again, change or remove a connection of the meeting's own */
function OwnActions({ c, confirm }: { c: ForgeConnectionView; confirm: ConfirmFn }) {
  const t = useTranslations("forges");
  const label = useConnectionLabel();
  const { s, rpc } = useRonde();
  const forges = s.settings.forges;
  const [editing, setEditing] = useState(false);
  return (
    <span className="forge-own-actions">
      <button type="button" className="btn sm" onClick={() => void rpc({ op: "forge.test", id: c.id }, t("works"))}>
        {t("test")}
      </button>
      {c.oauth ? (
        <ConnectWithGitlab slug={s.context.workspace.slug} meetingId={s.context.meetingId} connectionId={c.id} />
      ) : (
        <button type="button" className="btn sm" onClick={() => setEditing((x) => !x)}>
          {t("edit")}
        </button>
      )}
      <button
        type="button"
        className="btn sm danger"
        onClick={async () => {
          if (!(await confirm({ message: t("removeOwnConfirm", { name: label(c) }), confirmLabel: t("remove"), danger: true }))) return;
          await rpc({ op: "forge.remove", id: c.id });
        }}
      >
        {t("remove")}
      </button>
      {editing && (
        <ForgeConnectionForm
          connection={c}
          kinds={[c.kind]}
          servers={forges.servers}
          canEncrypt={s.integrations.secrets}
          onSubmit={async (d) => {
            const ok = await rpc(
              { op: "forge.update", id: c.id, name: d.name, url: d.url, ...(d.token ? { token: d.token } : {}) },
              t("saved"),
            );
            if (ok) setEditing(false);
            return ok;
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </span>
  );
}

/** A GitLab connection's groups and followed projects */
function GitlabFilters({
  c,
  source,
  saved,
  onChange,
}: {
  c: ForgeConnectionView;
  source: GitlabSource;
  saved: GitlabSource | undefined;
  onChange: (v: Partial<GitlabSource>) => void;
}) {
  const t = useTranslations("forges");
  return (
    <>
      <div className="field">
        <label htmlFor={`gGroups-${c.id}`}>{t("meeting.groups")}</label>
        <input
          id={`gGroups-${c.id}`}
          type="text"
          value={source.groups}
          onChange={(e) => onChange({ groups: e.target.value })}
          placeholder="my-group, my-group/sub-group"
        />
      </div>
      <div className="field">
        <span className="lbl-s">{t("meeting.projects")}</span>
        <GitlabProjectsPicker
          connection={c.id}
          savedGroups={saved?.groups ?? ""}
          value={source.projects}
          onChange={(projects) => onChange({ projects })}
          groupsChanged={source.groups !== (saved?.groups ?? "")}
        />
        <span className="hint">{t("meeting.projectsHint")}</span>
      </div>
    </>
  );
}

const splitList = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Pick the followed projects among those of the saved GitLab groups; ticking a group follows all its projects */
function GitlabProjectsPicker({
  connection,
  savedGroups,
  value,
  onChange,
  groupsChanged,
}: {
  connection: string;
  savedGroups: string;
  value: string;
  onChange: (v: string) => void;
  groupsChanged: boolean;
}) {
  const t = useTranslations("settings");
  const { api } = useRonde();
  const [projects, setProjects] = useState<GitlabProject[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const picked = useMemo(() => new Set(splitList(value)), [value]);
  const unreachable = t("gitlab.unreachable");

  const groups = splitList(savedGroups);
  useEffect(() => {
    setProjects(null);
    setError("");
    // No group saved yet: nothing to list
    if (!splitList(savedGroups).length) return;
    const params = new URLSearchParams({ connection, groups: savedGroups });
    fetch(api(`/gitlab/projects?${params}`), { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? unreachable);
        return (await r.json()) as GitlabProject[];
      })
      .then(setProjects)
      .catch((e: Error) => setError(e.message));
  }, [api, connection, savedGroups, unreachable]);

  const toggle = (path: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(path);
    else next.delete(path);
    onChange([...next].join(", "));
  };
  const inGroup = (p: string, g: string) => p.toLowerCase().startsWith(g.toLowerCase() + "/");
  const needle = q.trim().toLowerCase();
  const shown = (projects ?? []).filter((p) => !needle || p.path.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle));
  // Ticked projects no longer in the groups: shown so they can be unticked
  const orphans = [...picked].filter(
    (x) => projects && !groups.some((g) => g.toLowerCase() === x.toLowerCase()) && !projects.some((p) => p.path === x),
  );
  const searchId = `gSearch-${connection}`;

  return (
    <div className="gl-picker">
      <div className="controls">
        <span className="grow hint" style={{ flex: 1 }}>
          {picked.size ? t("gitlab.followed", { count: picked.size }) : t("gitlab.noFilter")}
        </span>
        {picked.size > 0 && (
          <button type="button" className="icon-btn" onClick={() => onChange("")}>
            {t("gitlab.untickAll")}
          </button>
        )}
      </div>
      {!groups.length ? (
        groupsChanged && <p className="hint">{t("gitlab.saveForGroups")}</p>
      ) : error ? (
        <p className="err">{error}</p>
      ) : projects === null ? (
        <p className="muted">{t("gitlab.loading")}</p>
      ) : (
        <>
          {groupsChanged && <p className="hint">{t("gitlab.saveForGroups")}</p>}
          <label htmlFor={searchId} className="sr-only">
            {t("gitlab.filter")}
          </label>
          <input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("gitlab.filterPlaceholder", { count: projects.length })}
          />
          <div className="gl-list">
            {orphans.map((x) => (
              <label className="check" key={x}>
                <input type="checkbox" checked onChange={() => toggle(x, false)} /> <code>{x}</code>{" "}
                <span className="hint">{t("gitlab.outsideGroups")}</span>
              </label>
            ))}
            {groups.map((g) => {
              const list = shown.filter((p) => p.group === g);
              const whole = [...picked].some((x) => x.toLowerCase() === g.toLowerCase());
              if (needle && !list.length) return null;
              return (
                <div key={g} className="gl-group">
                  <label className="check gl-group-head">
                    <input type="checkbox" checked={whole} onChange={(e) => toggle(g, e.target.checked)} /> <strong>{g}</strong>
                    <span className="hint">{t("gitlab.wholeGroup", { count: projects.filter((p) => p.group === g).length })}</span>
                  </label>
                  {list.map((p) => (
                    <label className="check" key={p.path} title={p.path}>
                      <input
                        type="checkbox"
                        disabled={whole && inGroup(p.path, g)}
                        checked={picked.has(p.path) || (whole && inGroup(p.path, g))}
                        onChange={(e) => toggle(p.path, e.target.checked)}
                      />{" "}
                      {p.name} <span className="hint">{p.path.slice(g.length + 1, -(p.path.split("/").pop()!.length + 1)) || ""}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
