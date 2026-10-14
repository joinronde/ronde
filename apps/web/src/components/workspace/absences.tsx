"use client";

import { formatters, type Locale } from "@ronde/i18n";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { addAbsenceAction, removeAbsenceAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { DateInput } from "@/components/date-input";
import { Select } from "@/components/select";
import type { AbsenceDTO } from "@/lib/server/absences";
import { Icon } from "../shell/icons";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A person's absences: days away, and who runs the meetings they host meanwhile */
export function AbsencesCard({
  slug,
  personId,
  isMe,
  canEdit,
  absences,
  delegates,
}: {
  slug: string;
  personId: string;
  isMe: boolean;
  canEdit: boolean;
  absences: AbsenceDTO[];
  delegates: { id: string; name: string }[];
}) {
  const t = useTranslations("absences");
  const fmt = formatters(useLocale() as Locale);
  const router = useRouter();
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [delegateId, setDelegateId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await addAbsenceAction(slug, { personId, from, to, note, delegateId: delegateId || null });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setAdding(false);
    setNote("");
    setDelegateId("");
    router.refresh();
  };
  const remove = async (absenceId: string) => {
    const res = await removeAbsenceAction(slug, absenceId);
    if (!res.ok) return setError(res.error);
    router.refresh();
  };
  const period = (a: { from: string; to: string }) =>
    a.from === a.to ? fmt.dateShort(a.from) : t("period", { from: fmt.dayMonth(a.from), to: fmt.dayMonth(a.to) });

  if (!canEdit && !absences.length) return null;
  return (
    <section className="dash-card pf-away" style={{ "--i": 3 } as React.CSSProperties} aria-labelledby={`${id}-title`}>
      <div className="dash-card-head">
        <h2 id={`${id}-title`}>
          <Icon name="calendar" size={16} /> {t("title")}
        </h2>
        {canEdit && !adding && (
          <button type="button" className="btn sm" onClick={() => setAdding(true)}>
            {t("add")}
          </button>
        )}
      </div>
      <FormAlert>{error}</FormAlert>
      {absences.length ? (
        <ul className="away-list">
          {absences.map((a) => (
            <li key={a.id}>
              <span className="away-dates">{period(a)}</span>
              {a.delegateName && <span className="hint">{t("standsIn", { name: a.delegateName })}</span>}
              {a.note && <span className="hint">{a.note}</span>}
              {canEdit && (
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={t("remove", { period: period(a) })}
                  onClick={() => void remove(a.id)}
                >
                  <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !adding && <p className="hint">{isMe ? t("emptyMine") : t("empty")}</p>
      )}
      {adding && (
        <form className="form away-form" onSubmit={(e) => void add(e)}>
          <p className="hint">{t("intro")}</p>
          <div className="grid2">
            <label className="field">
              <span>{t("from")}</span>
              <DateInput required value={from} onChange={setFrom} />
            </label>
            <label className="field">
              <span>{t("to")}</span>
              <DateInput required min={from} value={to} onChange={setTo} />
            </label>
          </div>
          <label className="field">
            <span>{t("delegate")}</span>
            <Select value={delegateId} onChange={(e) => setDelegateId(e.target.value)}>
              <option value="">{t("noDelegate")}</option>
              {delegates.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <span className="hint">{t("delegateHint")}</span>
          </label>
          <label className="field">
            <span>{t("note")}</span>
            <input type="text" maxLength={200} value={note} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="form-foot">
            <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
              {t("save")}
            </button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              {t("cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
