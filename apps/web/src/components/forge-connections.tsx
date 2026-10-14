"use client";

import type { ForgeConnectionView } from "@ronde/core/types";
import { Plug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Select } from "@/components/select";
import { withBasePath } from "@/lib/shared/base-path";
import { ToolMark } from "./tool-mark";

// GitLab and GitHub connections, as the workspace's settings and a meeting's show them: a line per connection,
// and the form that adds or changes one (a token), next to "Connect with GitLab"

export type ForgeKind = ForgeConnectionView["kind"];

export interface ForgeConnectionDraft {
  id?: string;
  kind: ForgeKind;
  name: string;
  url: string;
  token: string;
}

/** The connection's name; the instance's says whose it is */
export function useConnectionLabel() {
  const t = useTranslations("forges");
  return (c: ForgeConnectionView) => (c.scope === "instance" ? t("instanceName", { kind: t(`kinds.${c.kind}`) }) : c.name);
}

/** What a line says under the name: where it comes from, the server, the account */
export function ConnectionDetails({ c }: { c: ForgeConnectionView }) {
  const t = useTranslations("forges");
  const host = (() => {
    try {
      return new URL(c.url).host;
    } catch {
      return c.url;
    }
  })();
  return (
    <span className="hint forge-details">
      {[t(`scopes.${c.scope}`), host, c.account ? t("as", { account: c.account }) : "", c.oauth ? t("oauth") : ""]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

/** "Connect with GitLab": from the workspace's settings, or a meeting's (its own connection), or again for one */
export function ConnectWithGitlab({ slug, meetingId, connectionId }: { slug: string; meetingId?: string; connectionId?: string }) {
  const t = useTranslations("forges");
  const q = new URLSearchParams({ w: slug, ...(meetingId ? { m: meetingId } : {}), ...(connectionId ? { c: connectionId } : {}) });
  return (
    <a className={`btn${connectionId ? " sm" : " primary"}`} href={withBasePath(`/api/gitlab/connect?${q}`)}>
      <Plug size={connectionId ? 14 : 16} strokeWidth={2.2} aria-hidden="true" /> {connectionId ? t("reconnect") : t("connect")}
    </a>
  );
}

/** The form of a connection with a token; the kind is chosen for a new one only */
export function ForgeConnectionForm({
  connection,
  kinds,
  servers,
  canEncrypt,
  oauth,
  onSubmit,
  onCancel,
}: {
  connection: ForgeConnectionView | null;
  kinds: readonly ForgeKind[];
  servers: { gitlab: string; github: string };
  canEncrypt: boolean;
  /** "Connect with GitLab" offered instead of a token, for a new GitLab connection */
  oauth?: React.ReactNode;
  onSubmit: (draft: ForgeConnectionDraft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useTranslations("forges");
  const [kind, setKind] = useState<ForgeKind>(connection?.kind ?? kinds[0]!);
  const [name, setName] = useState(connection?.name ?? "");
  const [url, setUrl] = useState(connection && connection.url !== servers[connection.kind] ? connection.url : "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const ids = connection?.id ?? "new";
  return (
    <form
      className="form tracker-form forge-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await onSubmit({ ...(connection ? { id: connection.id } : {}), kind, name, url, token });
        setBusy(false);
        if (ok) setToken("");
      }}
    >
      {!connection && kinds.length > 1 && (
        <div className="field">
          <label htmlFor={`fgKind-${ids}`}>{t("kind")}</label>
          <Select id={`fgKind-${ids}`} value={kind} onChange={(e) => setKind(e.target.value as ForgeKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
      {!connection && kind === "gitlab" && oauth && (
        <div className="gl-connect">
          {oauth}
          <span className="hint">{t("connectHint")}</span>
          <span className="hint forge-or">{t("orToken")}</span>
        </div>
      )}
      <div className="grid2">
        <div className="field">
          <label htmlFor={`fgName-${ids}`}>{t("name")}</label>
          <input
            id={`fgName-${ids}`}
            value={name}
            maxLength={60}
            placeholder={t(`kinds.${kind}`)}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`fgUrl-${ids}`}>{t("url")}</label>
          <input id={`fgUrl-${ids}`} type="url" value={url} placeholder={servers[kind]} onChange={(e) => setUrl(e.target.value)} />
          <span className="hint">{t("urlHint", { url: servers[kind] })}</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`fgToken-${ids}`}>{t("token")}</label>
        <input
          id={`fgToken-${ids}`}
          type="password"
          autoComplete="off"
          required={!connection}
          disabled={!canEncrypt}
          value={token}
          placeholder={connection ? "••••" : kind === "gitlab" ? "glpat-…" : "github_pat_…"}
          onChange={(e) => setToken(e.target.value)}
        />
        <span className="hint">
          {t.rich(`tokenHints.${kind}`, { code: (chunks) => <code>{chunks}</code> })} {connection ? t("tokenKept") : t("encrypted")}
        </span>
      </div>
      {!canEncrypt && <div className="note-box">{t("noSecretKey")}</div>}
      <div className="form-foot">
        <button type="submit" className="btn primary" disabled={busy || !canEncrypt} aria-busy={busy}>
          {t("save")}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

/** The mark and name of a connection, for a list */
export function ConnectionName({ c }: { c: ForgeConnectionView }) {
  const label = useConnectionLabel();
  return (
    <span className="forge-name">
      <ToolMark kind={c.kind} size={18} />
      <strong>{label(c)}</strong>
    </span>
  );
}
