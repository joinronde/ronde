"use client";

import { CUSTOM_ROLE_PERMISSIONS, type Permission } from "@ronde/core/permissions";
import type { CustomRoleView } from "@ronde/editions/ee";
import { Modal } from "@ronde/ui/modal";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteRoleAction, saveRoleAction } from "@/app/w/[ws]/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { useConfirm } from "./confirm";

const MEETING_PERMISSIONS = new Set<Permission>([
  "meeting.read",
  "meeting.configure",
  "meeting.delete",
  "participants.manage",
  "session.run",
  "session.participate",
  "session.observe",
  "checkin.write.own",
  "checkin.read.all",
  "checkin.write.any",
  "notes.read",
  "minutes.edit",
  "history.read",
  "stats.read",
]);

const GROUPS: { key: "workspace" | "meetings"; permissions: Permission[] }[] = [
  { key: "workspace", permissions: CUSTOM_ROLE_PERMISSIONS.filter((p) => !MEETING_PERMISSIONS.has(p)) },
  { key: "meetings", permissions: CUSTOM_ROLE_PERMISSIONS.filter((p) => MEETING_PERMISSIONS.has(p)) },
];

type Draft = { id?: string; name: string; description: string; permissions: string[] };

/** Custom roles of the workspace: permissions added to the built-in role of the members holding one */
export function RolesView({ slug, roles, editable }: { slug: string; roles: CustomRoleView[]; editable: boolean }) {
  const t = useTranslations("roles");
  const tp = useTranslations("permissions");
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDialog, confirm] = useConfirm();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    const res = await saveRoleAction(slug, draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setDraft(null);
    router.refresh();
  };
  const remove = async (role: CustomRoleView) => {
    if (
      !(await confirm({ message: t("deleteConfirm", { name: role.name, count: role.members }), confirmLabel: t("delete"), danger: true }))
    )
      return;
    const res = await deleteRoleAction(slug, role.id);
    if (!res.ok) return setError(res.error);
    router.refresh();
  };
  const toggle = (p: string, on: boolean) =>
    setDraft((d) => d && { ...d, permissions: on ? [...d.permissions, p] : d.permissions.filter((x) => x !== p) });

  return (
    <div className="stack">
      {confirmDialog}
      <div className="page-head row">
        <p className="muted">{t("intro")}</p>
        {editable && (
          <button type="button" className="btn primary" onClick={() => setDraft({ name: "", description: "", permissions: [] })}>
            + {t("new")}
          </button>
        )}
      </div>
      {!editable && <p className="note-box">{t("readOnly")}</p>}
      {!draft && <FormAlert>{error}</FormAlert>}
      {roles.length ? (
        <ul className="role-list">
          {roles.map((r) => (
            <li key={r.id} className="panel">
              <div className="role-head">
                <strong>{r.name}</strong>
                <span className="hint">{t("members", { count: r.members })}</span>
              </div>
              {r.description && <p className="hint">{r.description}</p>}
              <p className="role-perms">
                {r.permissions.map((p) => (
                  <span key={p} className="st-pill st-open">
                    {tp(`${p}` as "meeting.read")}
                  </span>
                ))}
              </p>
              {editable && (
                <div className="controls">
                  <button type="button" className="btn sm" onClick={() => setDraft({ ...r })}>
                    {t("edit")}
                  </button>
                  <button type="button" className="btn sm danger" onClick={() => remove(r)}>
                    {t("delete")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="emptybox">
          <p>{t("empty")}</p>
          <p className="hint">{t("examples")}</p>
        </div>
      )}
      {draft && (
        <Modal onClose={() => setDraft(null)} labelledBy="roleTitle">
          <form className="form role-form" onSubmit={save}>
            <h2 id="roleTitle" style={{ margin: 0 }}>
              {draft.id ? t("editTitle") : t("newTitle")}
            </h2>
            <FormAlert>{error}</FormAlert>
            <Field label={t("name")}>
              {(p) => (
                <input {...p} required maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              )}
            </Field>
            <Field label={t("description")}>
              {(p) => (
                <input
                  {...p}
                  maxLength={300}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              )}
            </Field>
            {GROUPS.map((g) => (
              <fieldset key={g.key} className="plain stack">
                <legend className="lbl-s">{t(`groups.${g.key}`)}</legend>
                <p className="hint">{t(`groupHints.${g.key}`)}</p>
                <div className="perm-grid">
                  {g.permissions.map((p) => (
                    <label key={p} className="check">
                      <input type="checkbox" checked={draft.permissions.includes(p)} onChange={(e) => toggle(p, e.target.checked)} />{" "}
                      {tp(p as "meeting.read")}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="form-foot">
              <button type="submit" className="btn primary" disabled={busy}>
                {t("save")}
              </button>
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                {t("cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
