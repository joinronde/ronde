"use client";

import { roundsOrder } from "@ronde/core/agenda";
import { describeSchedule, occurrences, type ScheduleRule } from "@ronde/core/schedule";
import { formatters, type Locale } from "@ronde/i18n";
import { CATALOG } from "@ronde/modules/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { createMeetingAction, deleteTemplateAction } from "@/app/w/[ws]/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { PersonFace } from "@/components/person-face";
import { Select } from "@/components/select";
import type { TemplateSummary } from "@/lib/server/templates";
import { track } from "@/lib/shared/track";
import { useConfirm } from "./confirm";
import { browserTimeZone } from "./inputs";

interface Person {
  id: string;
  name: string;
  email: string;
  color: number;
  avatar: number | null;
  jobCategory: string;
}

interface Props {
  slug: string;
  people: Person[];
  canInvite: boolean;
  templates: TemplateSummary[];
  /** Modules of this edition */
  allowedModules: string[];
  /** Today in the workspace time zone */
  today: string;
  /** The workspace's, in which the schedule is set */
  timeZone: string;
  /** Template chosen in the gallery: the wizard opens on the details */
  initial?: string;
}

type Step = 0 | 1 | 2;

/** New meeting in three steps: a template, then name, schedule and people, then a review */
export function NewMeetingWizard({ slug, people, canInvite, templates, allowedModules, today, timeZone, initial }: Props) {
  const t = useTranslations("meetings.wizard");
  const tModules = useTranslations("modules");
  const locale = useLocale();
  const fmt = formatters(locale);
  const router = useRouter();
  const peopleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirmDialog, confirm] = useConfirm();
  const chosen = templates.find((x) => x.ref === initial);
  const tg = useTranslations("gallery");
  const [step, setStep] = useState<Step>(chosen ? 1 : 0);
  const [list, setList] = useState(templates);
  const [ref, setRef] = useState((chosen ?? templates[0]!).ref);
  const [category, setCategory] = useState<string>("all");
  const template = list.find((x) => x.ref === ref) ?? list[0]!;
  const first = template.data.schedule[0]!;
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [time, setTime] = useState(first.time);
  const [durationMin, setDurationMin] = useState(first.durationMin);
  const [weekday, setWeekday] = useState<number>(first.byDay[0] ?? 1);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(people.map((p) => p.id)));
  const [creatorSpeaks, setCreatorSpeaks] = useState(true);
  // A template with a round table and a project round: which one opens the meeting (the template's order until changed)
  const templateOrder = roundsOrder(template.data.agenda);
  const [orderPick, setOrderPick] = useState<{ ref: string; first: "team" | "projects" } | null>(null);
  const firstRound = orderPick?.ref === template.ref ? orderPick.first : templateOrder;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weeklyOneDay = first.freq === "weekly" && first.byDay.length <= 1;
  // The rule the meeting will get, to tell its rhythm and its first session (not the "from" date, which may be
  // any day of the week)
  const rule: ScheduleRule = {
    id: "new",
    freq: first.freq,
    interval: first.interval,
    byDay: weeklyOneDay ? [weekday] : first.byDay,
    setPos: first.setPos,
    monthDay: first.monthDay,
    startDate,
    until: null,
    count: null,
    time,
    durationMin,
  };
  const firstSession = occurrences([rule], [], timeZone, {
    from: startDate,
    to: `${Number(startDate.slice(0, 4)) + 1}${startDate.slice(4)}`,
  })[0];

  const go = (next: Step) => {
    setStep(next);
    setError(null);
    // The new step is announced: focus moves to its title
    requestAnimationFrame(() => heading.current?.focus());
  };
  const pick = (x: TemplateSummary) => {
    setRef(x.ref);
    const p = x.data.schedule[0]!;
    setTime(p.time);
    setDurationMin(p.durationMin);
    setWeekday(p.byDay[0] ?? 1);
  };
  // The template's tools, said in one line: they are turned on and off later, from the meeting's settings
  const tools = CATALOG.filter((m) => allowedModules.includes(m.id) && (template.data.modules[m.id]?.enabled ?? m.defaultEnabled));
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const remove = async (x: TemplateSummary) => {
    if (!(await confirm({ message: t("deleteTemplateConfirm", { name: x.name }), confirmLabel: t("deleteTemplate"), danger: true })))
      return;
    const res = await deleteTemplateAction(slug, x.ref);
    if (!res.ok) return setError(res.error);
    const rest = list.filter((y) => y.ref !== x.ref);
    setList(rest);
    if (ref === x.ref) pick(rest[0]!);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await createMeetingAction(slug, {
      name: name.trim() || template.name,
      template: template.ref,
      startDate,
      time,
      durationMin,
      weekday: weeklyOneDay ? weekday : null,
      personIds: [...picked],
      creatorSpeaks,
      modules: {},
      first: firstRound,
    });
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    // The built-in template it started from, never a workspace's own template name
    track("meeting_created", { template: template.ref.startsWith("builtin:") ? template.ref.slice(8) : "custom" });
    router.push(`/w/${slug}/m/${res.data.id}/control`);
  };

  const steps = [t("steps.template"), t("steps.details"), t("steps.review")];
  const allBuiltins = list.filter((x) => x.builtin);
  const categories = [...new Set(allBuiltins.map((x) => x.category))];
  const builtins = allBuiltins.filter((x) => category === "all" || x.category === category);
  const own = list.filter((x) => !x.builtin);
  const card = (x: TemplateSummary) => (
    <li key={x.ref}>
      <label className={`tpl-card${x.ref === ref ? " on" : ""}`}>
        <input type="radio" name="template" value={x.ref} checked={x.ref === ref} onChange={() => pick(x)} className="sr-only" />
        <span className="tpl-icon" aria-hidden="true">
          {x.icon}
        </span>
        <span className="tpl-text">
          <strong>{x.name}</strong>
          {x.description && <span className="hint">{x.description}</span>}
          <span className="tpl-meta">{x.schedule}</span>
          <span className="tpl-chips">
            {x.sections.map((s) => (
              <span key={s} className="tpl-chip">
                {s}
              </span>
            ))}
          </span>
        </span>
      </label>
      {x.canDelete && (
        <button
          type="button"
          className="icon-btn tpl-del"
          aria-label={t("deleteTemplateNamed", { name: x.name })}
          onClick={() => void remove(x)}
        >
          ✕
        </button>
      )}
    </li>
  );

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>{t("title")}</h1>
      </header>
      <ol className="wizard-steps">
        {steps.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : ""}>
            <span aria-hidden="true">{i < step ? "✓" : i + 1}</span> {label}
          </li>
        ))}
      </ol>
      <FormAlert>{error}</FormAlert>
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 2) go((step + 1) as Step);
          else void submit();
        }}
      >
        <h2 ref={heading} tabIndex={-1} className="wizard-title">
          {steps[step]}
        </h2>

        {step === 0 && (
          <fieldset className="plain stack">
            <legend className="sr-only">{t("steps.template")}</legend>
            <p className="hint">
              {t("templateHint")}{" "}
              <Link href={`/w/${slug}/templates`} className="link">
                {tg("browse")}
              </Link>
            </p>
            <div className="chips" role="group" aria-label={tg("categories")}>
              {["all", ...categories].map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {tg(`category.${c as "all"}`)}
                </button>
              ))}
            </div>
            <ul className="tpl-grid">{builtins.map(card)}</ul>
            {own.length > 0 && (
              <>
                <h3 className="lbl-s">{t("ownTemplates")}</h3>
                <ul className="tpl-grid">{own.map(card)}</ul>
              </>
            )}
          </fieldset>
        )}

        {step === 1 && (
          <>
            <Field label={t("name")}>
              {(p) => (
                <input
                  {...p}
                  type="text"
                  maxLength={100}
                  autoFocus
                  placeholder={template.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <fieldset className="plain">
              <legend className="lbl-s">{t("schedule")}</legend>
              <p className="hint">{t("scheduleHint", { schedule: template.schedule })}</p>
              <div className="grid2 stack-sm">
                <Field label={t("startDate")}>
                  {(p) => (
                    <input {...p} type="date" required min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  )}
                </Field>
                {weeklyOneDay && (
                  <Field label={t("weekday")}>
                    {(p) => (
                      <Select {...p} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                          <option key={d} value={d}>
                            {fmt.weekday(d)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                <Field label={t("time")}>
                  {(p) => <input {...p} type="time" required value={time} onChange={(e) => setTime(e.target.value)} />}
                </Field>
                <Field label={t("duration")}>
                  {(p) => (
                    <Select {...p} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
                      {[...new Set([15, 20, 30, 45, 60, 90, 120, durationMin])]
                        .sort((a, b) => a - b)
                        .map((m) => (
                          <option key={m} value={m}>
                            {t("minutes", { m })}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
              </div>
            </fieldset>
            <fieldset className="plain stack" aria-describedby={`${peopleId}-hint`}>
              <legend className="lbl-s">{t("people")}</legend>
              <span className="hint" id={`${peopleId}-hint`}>
                {t("peopleHint")}
              </span>
              {people.length === 0 ? (
                <p className="empty-state">
                  {t("nobody")}{" "}
                  {canInvite && (
                    <Link href={`/w/${slug}/people?invite=1`} className="link">
                      {t("invite")}
                    </Link>
                  )}
                </p>
              ) : (
                <>
                  <div className="row-between">
                    <span className="hint" aria-live="polite">
                      {t("selected", { count: picked.size })}
                    </span>
                    <span className="controls">
                      <button type="button" className="icon-btn" onClick={() => setPicked(new Set(people.map((p) => p.id)))}>
                        {t("selectAll")}
                      </button>
                      <button type="button" className="icon-btn" onClick={() => setPicked(new Set())}>
                        {t("selectNone")}
                      </button>
                    </span>
                  </div>
                  <ul className="pick-list">
                    {people.map((p) => (
                      <li key={p.id}>
                        <label className="pick">
                          <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                          <PersonFace slug={slug} person={p} />
                          <span className="person-text">
                            <span className="person-name">{p.name}</span>
                            <span className="hint">{[p.email, p.jobCategory].filter(Boolean).join(" · ")}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <label className="check">
                <input type="checkbox" checked={creatorSpeaks} onChange={(e) => setCreatorSpeaks(e.target.checked)} /> {t("creatorSpeaks")}
              </label>
            </fieldset>
            {firstRound && (
              <fieldset className="plain stack">
                <legend className="lbl-s">{t("order.title")}</legend>
                <div className="order-choice">
                  {(["team", "projects"] as const).map((o) => (
                    <label key={o} className={`order-option${firstRound === o ? " on" : ""}`}>
                      <input
                        type="radio"
                        name="first-round"
                        checked={firstRound === o}
                        onChange={() => setOrderPick({ ref: template.ref, first: o })}
                      />
                      <span>
                        <strong>{t(`order.${o}`)}</strong>
                        <span className="hint">{t(`order.${o}Hint`)}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <span className="hint">{t("order.later")}</span>
              </fieldset>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <dl className="recap">
              <dt>{t("name")}</dt>
              <dd>{name.trim() || template.name}</dd>
              <dt>{t("steps.template")}</dt>
              <dd>
                {template.icon} {template.name}
              </dd>
              <dt>{t("schedule")}</dt>
              <dd>
                {t("recapSchedule", {
                  schedule: describeSchedule([rule], timeZone, locale as Locale, browserTimeZone()),
                  duration: t("minutes", { m: durationMin }),
                  date: fmt.date(firstSession?.date ?? startDate),
                })}
              </dd>
              <dt>{t("people")}</dt>
              <dd>{t("recapPeople", { count: picked.size + (creatorSpeaks ? 1 : 0) })}</dd>
              {firstRound && (
                <>
                  <dt>{t("order.title")}</dt>
                  <dd>{t(`order.${firstRound}`)}</dd>
                </>
              )}
              <dt>{t("sections")}</dt>
              <dd>{template.sections.join(" · ")}</dd>
              {tools.length > 0 && (
                <>
                  <dt>{t("modules")}</dt>
                  <dd>
                    {tools.map((m) => `${m.icon} ${tModules(`items.${m.id}.name` as "items.kudos.name")}`).join(" · ")}
                    <span className="hint recap-note">{t("modulesLater")}</span>
                  </dd>
                </>
              )}
            </dl>
          </>
        )}

        <div className="form-foot">
          {step === 0 ? (
            <Link href={`/w/${slug}`} className="btn">
              {t("cancel")}
            </Link>
          ) : (
            <button type="button" className="btn" onClick={() => go((step - 1) as Step)}>
              ← {t("back")}
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
            {step < 2 ? `${t("next")} →` : t("create")}
          </button>
        </div>
      </form>
      {confirmDialog}
    </div>
  );
}
