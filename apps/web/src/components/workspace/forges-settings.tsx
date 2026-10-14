"use client";

import type { ForgeConnectionView } from "@ronde/core/types";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { deleteForgeConnectionAction, saveForgeConnectionAction, testForgeConnectionAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { ConnectionDetails, ConnectionName, ConnectWithGitlab, ForgeConnectionForm, useConnectionLabel } from "../forge-connections";
import type { useConfirm } from "./confirm";

type ConfirmFn = ReturnType<typeof useConfirm>[1];

const KINDS = ["gitlab", "github"] as const;

export interface ForgesSettingsProps {
  slug: string;
  /** The workspace's connections, then the instance's */
  connections: ForgeConnectionView[];
  servers: { gitlab: string; github: string };
  /** The server has a GitLab OAuth application */
  oauth: boolean;
  canEncrypt: boolean;
}

/** GitLab and GitHub connections of the workspace: every meeting may read through them, trackers write with them */
export function ForgesSettings({ slug, connections, servers, oauth, canEncrypt, confirm }: ForgesSettingsProps & { confirm: ConfirmFn }) {
  const t = useTranslations("forges");
  const label = useConnectionLabel();
  const router = useRouter();
  const [editing, setEditing] = useState<ForgeConnectionView | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  // Back from "Connect with GitLab" (?gitlab=connected): what happened
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("gitlab");
    if (result === "connected") setNotice(t("back.connected"));
    else if (result === "failed" || result === "denied" || result === "cancelled") setError(t(`back.${result}`));
  }, [t]);

  const save = async (draft: Parameters<typeof saveForgeConnectionAction>[1]) => {
    const res = await saveForgeConnectionAction(slug, draft);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setError(null);
    setEditing(null);
    router.refresh();
    return true;
  };

  return (
    <section className="panel forges" id="forges" aria-labelledby="forges-title">
      <h2 id="forges-title">{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      <FormAlert>{error}</FormAlert>
      {notice && (
        <p className="hint" role="status">
          ✓ {notice}
        </p>
      )}
      {connections.length ? (
        <ul className="tracker-list">
          {connections.map((c) => (
            <li key={c.id}>
              <span className="tracker-text">
                <ConnectionName c={c} />
                <ConnectionDetails c={c} />
                {c.scope === "instance" && <span className="hint">{t("instanceHint")}</span>}
              </span>
              <span className="hint" role="status">
                {status[c.id]}
              </span>
              {c.scope !== "instance" && (
                <>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={async () => {
                      setStatus((s) => ({ ...s, [c.id]: "…" }));
                      const res = await testForgeConnectionAction(slug, c.id);
                      setStatus((s) => ({ ...s, [c.id]: res.ok ? t("works") : "" }));
                      setError(res.ok ? null : res.error);
                      if (res.ok) router.refresh();
                    }}
                  >
                    {t("test")}
                  </button>
                  {c.oauth ? (
                    <ConnectWithGitlab slug={slug} connectionId={c.id} />
                  ) : (
                    <button type="button" className="btn sm" onClick={() => setEditing(c)}>
                      {t("edit")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn sm danger"
                    onClick={async () => {
                      if (!(await confirm({ message: t("removeConfirm", { name: label(c) }), confirmLabel: t("remove"), danger: true })))
                        return;
                      const res = await deleteForgeConnectionAction(slug, c.id);
                      if (!res.ok) return setError(res.error);
                      router.refresh();
                    }}
                  >
                    {t("remove")}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="emptybox">{t("empty")}</div>
      )}
      {editing ? (
        <ForgeConnectionForm
          key={editing === "new" ? "new" : editing.id}
          connection={editing === "new" ? null : editing}
          kinds={KINDS}
          servers={servers}
          canEncrypt={canEncrypt}
          oauth={oauth && <ConnectWithGitlab slug={slug} />}
          onSubmit={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            {t("add")}
          </button>
        </div>
      )}
    </section>
  );
}
