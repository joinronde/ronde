"use client";

import type { WorkspaceRole } from "@ronde/core/permissions";
import { Modal } from "@ronde/ui/modal";
import { MoreHorizontal, Pencil, Search, Send, Undo2, UserMinus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import {
  addPersonAction,
  assignRoleAction,
  changeRoleAction,
  inviteAction,
  removePersonAction,
  revokeInvitationAction,
  updatePersonAction,
} from "@/app/w/[ws]/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { type PickerTeam, TeamChip, teamAndBelow, teamOptions, teamPath } from "@/components/people-picker";
import { Select } from "@/components/select";
import { withBasePath } from "@/lib/shared/base-path";
import { track } from "@/lib/shared/track";
import { fullName, peopleMatching } from "@/lib/shared/workspace-lists";
import { initials } from "../shell/app-shell";
import { useConfirm } from "./confirm";
import { Menu } from "./menu";
import { PeopleTabs } from "./people-tabs";

export interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  birthday: string | null;
  phone: string | null;
  jobCategoryId: string | null;
  color: number;
  /** Version of the photo, null when the person has none */
  avatar: number | null;
  hasAccount: boolean;
  role: WorkspaceRole | null;
  /** Custom role of the workspace (Enterprise) */
  customRoleId: string | null;
  status: "active" | "invited" | "directory";
  invitation: { id: string; expiresAt: string; role: WorkspaceRole } | null;
  isMe: boolean;
  /** Someone of the sample meeting's fictitious team: shown as such, never invited */
  sample: boolean;
}

interface Props {
  slug: string;
  workspaceName: string;
  people: PersonRow[];
  categories: PickerTeam[];
  /** Team picked in the address (?team=), its sub-teams included */
  team: string | null;
  canInvite: boolean;
  canManage: boolean;
  canChangeRoles: boolean;
  assignable: WorkspaceRole[];
  /** Custom roles of the workspace; null when the license has none */
  customRoles: { id: string; name: string }[] | null;
  customRolesEditable: boolean;
  mailConfigured: boolean;
  openInvite: boolean;
  openEdit: string | null;
}

type Dialog =
  | { kind: "invite"; person?: PersonRow }
  | { kind: "add" }
  | { kind: "edit"; person: PersonRow }
  | { kind: "link"; email: string; url: string; emailed: boolean };

export function PeopleDirectory(props: Props) {
  const { slug, workspaceName, people, categories, canInvite, canManage, canChangeRoles, assignable, customRoles, customRolesEditable } =
    props;
  const t = useTranslations("people");
  const tw = useTranslations("workspace");
  const tSample = useTranslations("sample");
  const format = useFormatter();
  const router = useRouter();
  const path = usePathname();
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(() => {
    if (props.openInvite && canInvite) return { kind: "invite" };
    const person = props.openEdit ? people.find((p) => p.id === props.openEdit) : undefined;
    return person && (canManage || person.isMe) ? { kind: "edit", person } : null;
  });
  // A team is searched by its whole path: "Product › Design" finds the people of both
  const category = useMemo(() => new Map(categories.map((c) => [c.id, teamPath(categories, c.id)])), [categories]);
  const [confirmDialog, confirm] = useConfirm();
  const [team, setTeam] = useState(props.team ?? "");
  const inTeam = useMemo(() => (team ? teamAndBelow(categories, team) : null), [categories, team]);

  const shown = useMemo(
    () => peopleMatching(people, query, category).filter((p) => !inTeam || (p.jobCategoryId && inTeam.has(p.jobCategoryId))),
    [people, query, category, inTeam],
  );

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };
  const close = () => {
    setDialog(null);
    // Drop ?invite / ?edit so a refresh does not reopen the dialog
    if (props.openInvite || props.openEdit) router.replace(path);
  };
  const act = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string) => {
    setError(null);
    const res = await fn();
    if (!res.ok) return setError(res.error);
    if (success) flash(success);
  };

  return (
    <div className="page">
      <PeopleTabs slug={slug} />
      <header className="page-head row">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("intro", { workspace: workspaceName })}</p>
        </div>
        <div className="actions">
          {canManage && (
            <button type="button" className="btn" onClick={() => setDialog({ kind: "add" })}>
              {t("add")}
            </button>
          )}
          {canInvite && (
            <button type="button" className="btn primary" onClick={() => setDialog({ kind: "invite" })}>
              {t("invite")}
            </button>
          )}
        </div>
      </header>
      <FormAlert>{error}</FormAlert>
      <div className="toolbar">
        <label className="search-input">
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            placeholder={t("search")}
            aria-label={t("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {categories.length > 0 && (
          <Select
            className="compact team-filter"
            searchable={categories.length > 8}
            aria-label={t("teamFilter")}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">{t("allTeams")}</option>
            {teamOptions(categories).map(({ team: c, depth }) => (
              <option key={c.id} value={c.id}>
                {`${"  ".repeat(depth)}${depth ? "↳ " : ""}${c.name}`}
              </option>
            ))}
          </Select>
        )}
        <span className="hint" aria-live="polite">
          {t("count", { count: shown.length })}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="empty-state">{t("empty", { query })}</p>
      ) : (
        <div className="table-wrap">
          <table className="table people">
            <thead>
              <tr>
                <th scope="col">{t("columns.name")}</th>
                <th scope="col">{t("columns.category")}</th>
                <th scope="col">{t("columns.role")}</th>
                <th scope="col">{t("columns.status")}</th>
                <th scope="col">
                  <span className="sr-only">{t("columns.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const name = fullName(p);
                const editable = canManage || p.isMe;
                const roleEditable = canChangeRoles && !p.isMe && p.role && assignable.includes(p.role);
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="person">
                        <span
                          className={`av sm${p.avatar ? " img" : ""}`}
                          style={{ "--c": `var(--c${p.color % 6})` } as React.CSSProperties}
                          aria-hidden="true"
                        >
                          {p.avatar ? (
                            <img src={withBasePath(`/api/w/${slug}/avatar/${p.id}?v=${p.avatar}`)} alt="" loading="lazy" />
                          ) : (
                            initials(name)
                          )}
                        </span>
                        <span className="person-text">
                          <span className="person-name">
                            <Link href={`/w/${slug}/people/${p.id}`} className="person-link">
                              {name}
                            </Link>
                            {p.isMe && <span className="hint"> ({t("you")})</span>}
                          </span>
                          <span className="hint">{p.sample ? tSample("personHint") : p.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <TeamChip teams={categories} id={p.jobCategoryId} />
                    </td>
                    <td>
                      {p.role && roleEditable ? (
                        <Select
                          className="compact"
                          aria-label={t("changeRole", { name })}
                          value={p.role}
                          onChange={(e) => act(() => changeRoleAction(slug, p.id, e.target.value as WorkspaceRole), t("saved"))}
                        >
                          {assignable.map((r) => (
                            <option key={r} value={r}>
                              {tw(`roles.${r}`)}
                            </option>
                          ))}
                        </Select>
                      ) : p.role ? (
                        <span title={tw(`roleHints.${p.role}`)}>{tw(`roles.${p.role}`)}</span>
                      ) : p.invitation ? (
                        // Role given once the invitation is accepted
                        <span className="role-pending" title={tw(`roleHints.${p.invitation.role}`)}>
                          {tw(`roles.${p.invitation.role}`)}
                        </span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                      {customRoles && customRoles.length > 0 && (p.role === "organizer" || p.role === "member" || p.role === "guest") && (
                        <CustomRoleCell
                          slug={slug}
                          person={p}
                          name={name}
                          roles={customRoles}
                          editable={canChangeRoles && customRolesEditable}
                          onDone={(res) => act(() => Promise.resolve(res), t("saved"))}
                        />
                      )}
                    </td>
                    <td>
                      {p.sample ? (
                        <span className="sample-chip">{tSample("badge")}</span>
                      ) : (
                        <span
                          className={`st-pill st-${p.status === "active" ? "done" : p.status === "invited" ? "doing" : "open"}`}
                          title={
                            p.status === "invited" && p.invitation
                              ? t("statusHints.invited", {
                                  date: format.dateTime(new Date(p.invitation.expiresAt), { dateStyle: "medium" }),
                                })
                              : p.status === "directory"
                                ? t("statusHints.directory")
                                : undefined
                          }
                        >
                          {t(`status.${p.status}`)}
                        </span>
                      )}
                    </td>
                    <td className="row-actions">
                      {(editable || canInvite || canManage) && (
                        <Menu label={t("actionsFor", { name })} button={<MoreHorizontal size={18} strokeWidth={2} aria-hidden="true" />}>
                          {(closeMenu) => (
                            <>
                              {editable && (
                                <button
                                  type="button"
                                  className="menu-item"
                                  onClick={() => {
                                    closeMenu();
                                    setDialog({ kind: "edit", person: p });
                                  }}
                                >
                                  <Pencil className="ico" size={16} strokeWidth={1.9} aria-hidden="true" />
                                  {t("edit")}
                                </button>
                              )}
                              {canInvite && p.status !== "active" && !p.sample && (
                                <button
                                  type="button"
                                  className="menu-item"
                                  onClick={() => {
                                    closeMenu();
                                    setDialog({ kind: "invite", person: p });
                                  }}
                                >
                                  <Send className="ico" size={16} strokeWidth={1.9} aria-hidden="true" />
                                  {t("inviteAgain")}
                                </button>
                              )}
                              {canInvite && p.invitation && (
                                <button
                                  type="button"
                                  className="menu-item"
                                  onClick={() => {
                                    closeMenu();
                                    act(() => revokeInvitationAction(slug, p.invitation!.id), t("saved"));
                                  }}
                                >
                                  <Undo2 className="ico" size={16} strokeWidth={1.9} aria-hidden="true" />
                                  {t("revoke")}
                                </button>
                              )}
                              {canManage && !p.isMe && (
                                <button
                                  type="button"
                                  className="menu-item danger"
                                  onClick={async () => {
                                    closeMenu();
                                    const ok = await confirm({
                                      message: t("removeConfirm", { name, workspace: workspaceName }),
                                      confirmLabel: t("remove"),
                                      danger: true,
                                    });
                                    if (ok) act(() => removePersonAction(slug, p.id), t("removed", { name }));
                                  }}
                                >
                                  <UserMinus className="ico" size={16} strokeWidth={1.9} aria-hidden="true" />
                                  {t("remove")}
                                </button>
                              )}
                            </>
                          )}
                        </Menu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dialog?.kind === "invite" && (
        <PersonDialog
          mode="invite"
          person={dialog.person}
          categories={categories}
          roles={assignable}
          onClose={close}
          onSubmit={async (input) => {
            const res = await inviteAction(slug, { ...input, role: input.role ?? "member" });
            if (res.ok) {
              track("invite_sent");
              setDialog({ kind: "link", email: input.email, url: res.data.url, emailed: res.data.emailed });
            }
            return res;
          }}
        />
      )}
      {dialog?.kind === "add" && (
        <PersonDialog
          mode="add"
          categories={categories}
          onClose={close}
          onSubmit={async (input) => {
            const res = await addPersonAction(slug, input);
            if (res.ok) {
              close();
              flash(t("saved"));
            }
            return res;
          }}
        />
      )}
      {dialog?.kind === "edit" && (
        <PersonDialog
          mode="edit"
          person={dialog.person}
          categories={categories}
          onClose={close}
          onSubmit={async (input) => {
            const res = await updatePersonAction(slug, dialog.person.id, input);
            if (res.ok) {
              close();
              flash(t("saved"));
            }
            return res;
          }}
        />
      )}
      {dialog?.kind === "link" && <InvitationLink {...dialog} mailConfigured={props.mailConfigured} onClose={close} />}
      {confirmDialog}
      {toast && (
        <div className="toast ok" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

interface PersonFormValues {
  email: string;
  firstName: string;
  lastName: string;
  jobCategoryId: string | null;
  birthday: string | null;
  phone: string | null;
  role?: WorkspaceRole;
}

function PersonDialog({
  mode,
  person,
  categories,
  roles,
  onClose,
  onSubmit,
}: {
  mode: "invite" | "add" | "edit";
  person?: PersonRow;
  categories: PickerTeam[];
  roles?: WorkspaceRole[];
  onClose: () => void;
  onSubmit: (values: PersonFormValues) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const t = useTranslations("people");
  const tw = useTranslations("workspace");
  const format = useFormatter();
  const titleId = useId();
  const [values, setValues] = useState<PersonFormValues>({
    email: person?.email ?? "",
    firstName: person?.firstName ?? "",
    lastName: person?.lastName ?? "",
    jobCategoryId: person?.jobCategoryId ?? null,
    birthday: person?.birthday ?? null,
    phone: person?.phone ?? null,
    role: mode === "invite" ? "member" : undefined,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<PersonFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const [month, day] = (values.birthday ?? "-").split("-");
  const setBirthday = (m: string, d: string) => set({ birthday: m && d ? `${m}-${d}` : null });
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1).padStart(2, "0"),
    label: format.dateTime(new Date(2000, i, 1), { month: "long" }),
  }));
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
  const emailLocked = mode === "edit" && !!person?.hasAccount;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await onSubmit(values);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  const title = mode === "invite" ? t("inviteTitle") : mode === "add" ? t("addTitle") : t("editTitle", { name: fullName(person!) });
  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <form className="form dialog-form" onSubmit={submit}>
        <div>
          <h2 id={titleId}>{title}</h2>
          {mode !== "edit" && <p className="hint">{mode === "invite" ? t("inviteHint") : t("addHint")}</p>}
        </div>
        <FormAlert>{error}</FormAlert>
        <Field label={t("email")} hint={emailLocked ? t("emailLocked") : undefined}>
          {(p) => (
            <input
              {...p}
              type="email"
              required
              autoComplete="off"
              disabled={emailLocked || (mode === "invite" && !!person)}
              value={values.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          )}
        </Field>
        <div className="grid2">
          <Field label={t("firstName")}>
            {(p) => <input {...p} type="text" required value={values.firstName} onChange={(e) => set({ firstName: e.target.value })} />}
          </Field>
          <Field label={t("lastName")}>
            {(p) => <input {...p} type="text" value={values.lastName} onChange={(e) => set({ lastName: e.target.value })} />}
          </Field>
        </div>
        <div className="grid2">
          <Field label={t("category")}>
            {(p) => (
              <Select {...p} value={values.jobCategoryId ?? ""} onChange={(e) => set({ jobCategoryId: e.target.value || null })}>
                <option value="">{t("noCategory")}</option>
                {teamOptions(categories).map(({ team: c, depth }) => (
                  <option key={c.id} value={c.id}>
                    {`${"  ".repeat(depth)}${depth ? "↳ " : ""}${c.name}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {mode === "invite" && roles ? (
            <Field label={t("role")} hint={values.role ? tw(`roleHints.${values.role}`) : undefined}>
              {(p) => (
                <Select {...p} value={values.role} onChange={(e) => set({ role: e.target.value as WorkspaceRole })}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {tw(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <fieldset className="field birthday">
              <legend>{t("birthday")}</legend>
              <span className="inline">
                <Select aria-label={t("month")} value={month ?? ""} onChange={(e) => setBirthday(e.target.value, day || "01")}>
                  <option value="">—</option>
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={t("day")}
                  value={day ?? ""}
                  disabled={!month}
                  onChange={(e) => setBirthday(month ?? "", e.target.value)}
                >
                  <option value="">—</option>
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {Number(d)}
                    </option>
                  ))}
                </Select>
              </span>
              <span className="hint">{t("birthdayHint")}</span>
            </fieldset>
          )}
        </div>
        {mode !== "invite" && (
          <Field label={t("phone")} hint={t("phoneHint")}>
            {(p) => (
              <input
                {...p}
                type="tel"
                autoComplete="off"
                placeholder="+33612345678"
                value={values.phone ?? ""}
                onChange={(e) => set({ phone: e.target.value || null })}
              />
            )}
          </Field>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
            {mode === "invite" ? t("send") : mode === "add" ? t("addPerson") : t("save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InvitationLink({
  email,
  url,
  emailed,
  mailConfigured,
  onClose,
}: {
  email: string;
  url: string;
  emailed: boolean;
  mailConfigured: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("people");
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <div className="form dialog-form">
        <h2 id={titleId}>{t("linkTitle")}</h2>
        {emailed && <FormAlert tone="ok">{t("invited", { email })}</FormAlert>}
        <p className="hint">{mailConfigured ? t("linkShare") : t("linkNoMail")}</p>
        <span className="copy-row">
          <input type="text" readOnly value={url} aria-label={t("linkTitle")} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn" onClick={copy}>
            {copied ? t("copied") : t("copy")}
          </button>
        </span>
        <div className="dialog-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Custom role of a member or guest (Enterprise): permissions added to their role */
function CustomRoleCell({
  slug,
  person,
  name,
  roles,
  editable,
  onDone,
}: {
  slug: string;
  person: PersonRow;
  name: string;
  roles: { id: string; name: string }[];
  editable: boolean;
  onDone: (res: Awaited<ReturnType<typeof assignRoleAction>>) => void;
}) {
  const t = useTranslations("people");
  const current = roles.find((r) => r.id === person.customRoleId);
  if (!editable) return current ? <span className="hint custom-role"> + {current.name}</span> : null;
  return (
    <Select
      className="compact custom-role"
      aria-label={t("customRoleOf", { name })}
      value={person.customRoleId ?? ""}
      onChange={async (e) => onDone(await assignRoleAction(slug, person.id, e.target.value || null))}
    >
      <option value="">{t("noCustomRole")}</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          + {r.name}
        </option>
      ))}
    </Select>
  );
}
