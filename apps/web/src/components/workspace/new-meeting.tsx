"use client";

import { roundsOrder } from "@ronde/core/agenda";
import { describeSchedule, occurrences, type ScheduleRule } from "@ronde/core/schedule";
import type { SectionDef, SectionRole, SectionType } from "@ronde/core/types";
import { ROLE_KIND, SECTION_TYPES } from "@ronde/core/util";
import { formatters, type Locale } from "@ronde/i18n";
import { CATALOG } from "@ronde/modules/catalog";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Briefcase,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  GraduationCap,
  HardHat,
  HeartHandshake,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Pencil,
  Plus,
  Rocket,
  Search,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { createMeetingAction, deleteTemplateAction } from "@/app/w/[ws]/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { DateInput } from "@/components/date-input";
import { DurationField } from "@/components/duration-field";
import { PeoplePicker, type PickerPerson, type PickerTeam } from "@/components/people-picker";
import { Select } from "@/components/select";
import { TimeInput } from "@/components/time-input";
import type { TemplateSummary } from "@/lib/server/templates";
import { fold } from "@/lib/shared/search";
import { track } from "@/lib/shared/track";
import { useConfirm } from "./confirm";
import { browserTimeZone } from "./inputs";
import { Menu } from "./menu";

interface Props {
  slug: string;
  people: PickerPerson[];
  teams: PickerTeam[];
  canInvite: boolean;
  templates: TemplateSummary[];
  /** Starting from nothing */
  blank: TemplateSummary;
  /** Modules of this edition */
  allowedModules: string[];
  /** Today in the workspace time zone */
  today: string;
  /** The workspace's, in which the schedule is set */
  timeZone: string;
  /** Template chosen in the gallery: the wizard opens on the details */
  initial?: string;
}

type Step = 0 | 1 | 2 | 3;
const STEPS = ["start", "details", "content", "review"] as const;
const STEP_ICONS = [Sparkles, CalendarClock, SlidersHorizontal, ClipboardCheck];
const CATEGORY_ICONS: Record<string, typeof Users> = {
  all: LayoutGrid,
  team: Users,
  product: Rocket,
  leadership: Briefcase,
  education: GraduationCap,
  nonprofit: HeartHandshake,
  field: HardHat,
  health: Stethoscope,
  own: Bookmark,
};
export const ROLE_ICONS: Record<SectionRole, typeof Users> = {
  achievement: CheckCircle2,
  plan: CalendarClock,
  blocker: AlertTriangle,
  note: MessageSquare,
  custom: Tag,
};
const MODULE_GROUPS = ["facilitation", "organisation", "formats", "integrations"] as const;
const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");

/** New meeting in four steps: where to start from, then schedule and people, then sections and modules, then a review */
export function NewMeetingWizard({ slug, people, teams, canInvite, templates, blank, allowedModules, today, timeZone, initial }: Props) {
  const t = useTranslations("meetings.wizard");
  const tModules = useTranslations("modules");
  const tSections = useTranslations("sections");
  const tg = useTranslations("gallery");
  const locale = useLocale();
  const fmt = formatters(locale);
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [list, setList] = useState(templates);
  const all = [blank, ...list];
  const chosen = all.find((x) => x.ref === initial);
  const [step, setStep] = useState<Step>(chosen ? 1 : 0);
  const [ref, setRef] = useState((chosen ?? templates[0] ?? blank).ref);
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const template = all.find((x) => x.ref === ref) ?? blank;
  const first = template.data.schedule[0]!;
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [time, setTime] = useState(first.time);
  const [durationMin, setDurationMin] = useState(first.durationMin);
  const [weekday, setWeekday] = useState<number>(first.byDay[0] ?? 1);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(people.map((p) => p.id)));
  const [creatorSpeaks, setCreatorSpeaks] = useState(true);
  const modulesOf = (x: TemplateSummary) =>
    Object.fromEntries(
      CATALOG.filter((m) => allowedModules.includes(m.id)).map((m) => [m.id, x.data.modules[m.id]?.enabled ?? m.defaultEnabled]),
    );
  const [sections, setSections] = useState<SectionDef[]>(template.data.sections);
  const [mods, setMods] = useState<Record<string, boolean>>(() => modulesOf(template));
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
    setSections(x.data.sections);
    setMods(modulesOf(x));
  };
  const remove = async (x: TemplateSummary) => {
    if (!(await confirm({ message: t("deleteTemplateConfirm", { name: x.name }), confirmLabel: t("deleteTemplate"), danger: true })))
      return;
    const res = await deleteTemplateAction(slug, x.ref);
    if (!res.ok) return setError(res.error);
    const rest = list.filter((y) => y.ref !== x.ref);
    setList(rest);
    if (ref === x.ref) pick(rest[0] ?? blank);
  };
  const sectionLabel = (s: SectionDef) =>
    s.label.trim() || (s.role === "custom" ? t("content.custom") : tSections(`defaults.${ROLE_KIND[s.role]}` as "defaults.done"));
  const usedRoles = new Set(sections.map((s) => s.role));
  const addSection = (role: SectionRole) => {
    const key = role !== "custom" && !sections.some((s) => s.key === ROLE_KIND[role]) ? ROLE_KIND[role] : randomKey();
    setSections([...sections, { key, role, input: "list", label: "" }]);
  };
  const editSection = (i: number, patch: Partial<SectionDef>) => setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const allowed = CATALOG.filter((m) => allowedModules.includes(m.id));
  const tools = allowed.filter((m) => mods[m.id]);

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
      modules: mods,
      // A section of its own left unnamed takes the name it showed (its placeholder): it needs one
      sections: sections.map((s) => ({ ...s, label: s.label.trim() || (s.role === "custom" ? sectionLabel(s) : "") })),
      first: firstRound,
    });
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    // The built-in template it started from, never a workspace's own template name
    track("meeting_created", {
      template: template.ref.startsWith("builtin:") ? template.ref.slice(8) : template.ref === blank.ref ? "blank" : "custom",
    });
    router.push(`/w/${slug}/m/${res.data.id}/control`);
  };
  const valid = (s: Step) => s !== 2 || sections.length > 0;

  // Step 0: where to start from
  const builtins = list.filter((x) => x.builtin);
  const own = list.filter((x) => !x.builtin);
  const categories = [...new Set(builtins.map((x) => x.category)), ...(own.length ? ["own"] : [])];
  const q = fold(query.trim());
  const shown = list
    .filter((x) => category === "all" || x.category === category)
    .filter((x) => !q || fold(`${x.name} ${x.description} ${x.sections.join(" ")}`).includes(q));
  const card = (x: TemplateSummary, extra = "") => (
    <li key={x.ref} className="nm-tpl-li">
      <label className={`nm-tpl${x.ref === ref ? " on" : ""}${extra}`} onDoubleClick={() => go(1)}>
        <input type="radio" name="template" value={x.ref} checked={x.ref === ref} onChange={() => pick(x)} className="sr-only" />
        <span className="nm-tpl-icon" aria-hidden="true">
          {x.ref === blank.ref ? <Plus size={22} strokeWidth={2.2} /> : x.icon}
        </span>
        <span className="nm-tpl-text">
          <strong>{x.name}</strong>
          <span className="nm-tpl-meta">
            <Clock size={13} strokeWidth={2} aria-hidden="true" />
            {x.ref === blank.ref ? t("blank.meta") : x.schedule}
          </span>
          {x.description && <span className="nm-tpl-desc">{x.description}</span>}
        </span>
        <span className="nm-tpl-check" aria-hidden="true">
          <Check size={14} strokeWidth={3} />
        </span>
      </label>
      {x.canDelete && (
        <button
          type="button"
          className="icon-btn danger nm-tpl-del"
          aria-label={t("deleteTemplateNamed", { name: x.name })}
          onClick={() => void remove(x)}
        >
          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </li>
  );

  const preview = (
    // Scrolls on its own when long: it takes the focus so the keyboard can scroll it too
    <aside className="nm-preview" aria-label={t("preview.title")} tabIndex={0}>
      <span className="nm-preview-icon" aria-hidden="true">
        {template.ref === blank.ref ? <Plus size={30} strokeWidth={2} /> : template.icon}
      </span>
      <h3>{template.name}</h3>
      {template.description && <p className="hint">{template.description}</p>}
      <dl className="nm-facts">
        <div>
          <dt>
            <Clock size={15} strokeWidth={2} aria-hidden="true" /> {t("preview.rhythm")}
          </dt>
          <dd>{template.ref === blank.ref ? t("blank.meta") : template.schedule}</dd>
        </div>
        <div>
          <dt>
            <ListChecks size={15} strokeWidth={2} aria-hidden="true" /> {t("preview.sections")}
          </dt>
          <dd className="nm-chips">
            {template.data.sections.map((s, i) => {
              const RoleIcon = ROLE_ICONS[s.role];
              return (
                <span key={s.key} className={`nm-chip role-${s.role}`}>
                  <RoleIcon size={13} strokeWidth={2.2} aria-hidden="true" />
                  {template.sections[i]}
                </span>
              );
            })}
          </dd>
        </div>
        <div>
          <dt>
            <SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" /> {t("preview.modules")}
          </dt>
          <dd className="nm-chips">
            {allowed.filter((m) => modulesOf(template)[m.id]).length === 0 ? (
              <span className="hint">{t("preview.noModules")}</span>
            ) : (
              allowed
                .filter((m) => modulesOf(template)[m.id])
                .map((m) => (
                  <span key={m.id} className="nm-chip">
                    <span aria-hidden="true">{m.icon}</span>
                    {tModules(`items.${m.id}.name` as "items.kudos.name")}
                  </span>
                ))
            )}
          </dd>
        </div>
      </dl>
    </aside>
  );

  return (
    <div className="nm-wizard">
      <header className="nm-head">
        <h1>{t("title")}</h1>
        <p className="hint">{t("subtitle")}</p>
      </header>
      <ol className="nm-steps">
        {STEPS.map((id, i) => {
          const StepIcon = STEP_ICONS[i]!;
          const reachable = i < step || (i === step + 1 && valid(step as Step));
          return (
            <li key={id} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : ""}>
              <button type="button" disabled={!reachable && i !== step} onClick={() => i !== step && go(i as Step)}>
                <span className="nm-step-dot" aria-hidden="true">
                  {i < step ? <Check size={16} strokeWidth={3} /> : <StepIcon size={16} strokeWidth={2.1} />}
                </span>
                <span className="nm-step-text">
                  <span className="nm-step-n">{t("stepOf", { n: i + 1, total: STEPS.length })}</span>
                  {t(`steps.${id}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <FormAlert>{error}</FormAlert>
      <form
        className="nm-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid(step)) return;
          if (step < 3) go((step + 1) as Step);
          else void submit();
        }}
      >
        <h2 ref={heading} tabIndex={-1} className="sr-only">
          {t(`steps.${STEPS[step]}`)}
        </h2>

        {step === 0 && (
          <div className="nm-browse">
            <div className="nm-browse-main">
              <ul className="nm-start">{card(blank, " nm-blank")}</ul>
              <div className="nm-tools">
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
                <Link href={`/w/${slug}/templates`} className="link nm-gallery">
                  {tg("browse")}
                </Link>
              </div>
              <div className="nm-cats" role="group" aria-label={tg("categories")}>
                {["all", ...categories].map((c) => {
                  const CatIcon = CATEGORY_ICONS[c] ?? LayoutGrid;
                  const n = c === "all" ? list.length : list.filter((x) => x.category === c).length;
                  return (
                    <button key={c} type="button" className="nm-cat" aria-pressed={category === c} onClick={() => setCategory(c)}>
                      <CatIcon size={14} strokeWidth={2} aria-hidden="true" />
                      {tg(`category.${c as "all"}`)}
                      <span className="nm-cat-n">{n}</span>
                    </button>
                  );
                })}
              </div>
              <fieldset className="plain nm-list">
                <legend className="sr-only">{t("steps.start")}</legend>
                {shown.length ? <ul className="nm-grid">{shown.map((x) => card(x))}</ul> : <p className="empty-state">{t("noMatch")}</p>}
              </fieldset>
            </div>
            {preview}
          </div>
        )}

        {step === 1 && (
          <div className="nm-split">
            <div className="nm-pane stack">
              <h3 className="nm-pane-title">
                <CalendarClock size={18} strokeWidth={2} aria-hidden="true" /> {t("schedule")}
              </h3>
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
              <div className="grid2">
                <Field label={t("startDate")}>
                  {(p) => <DateInput {...p} required min={today} value={startDate} onChange={setStartDate} />}
                </Field>
                {weeklyOneDay && (
                  <Field label={t("weekday")}>
                    {(p) => (
                      <Select {...p} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                          <option key={d} value={d}>
                            {fmt.weekday(d % 7).replace(/^./, (c) => c.toLocaleUpperCase(locale))}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                <Field label={t("time")}>{(p) => <TimeInput {...p} required value={time} onChange={setTime} />}</Field>
                <div className="field">
                  <label htmlFor="nm-duration">{t("duration")}</label>
                  <DurationField
                    id="nm-duration"
                    value={durationMin}
                    unit="minutes"
                    presets={[15, 20, 30, 45, 60, 90, 120]}
                    min={5}
                    max={480}
                    format={(m) =>
                      m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}` : t("minutes", { m })
                    }
                    onChange={setDurationMin}
                    labels={{ custom: "", big: "", small: "", bigUnit: "", smallUnit: "", range: t("durationRange") }}
                  />
                </div>
              </div>
              <p className="hint nm-rule">
                <CalendarClock size={14} strokeWidth={2} aria-hidden="true" />
                {t("recapSchedule", {
                  schedule: describeSchedule([rule], timeZone, locale as Locale, browserTimeZone()),
                  duration: t("minutes", { m: durationMin }),
                  date: fmt.date(firstSession?.date ?? startDate),
                })}
              </p>
              <p className="hint">{t("scheduleLater")}</p>
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
            </div>
            <div className="nm-pane stack">
              <h3 className="nm-pane-title">
                <Users size={18} strokeWidth={2} aria-hidden="true" /> {t("people")}
              </h3>
              <p className="hint">{t("peopleHint")}</p>
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
                <PeoplePicker slug={slug} people={people} teams={teams} picked={picked} onChange={setPicked} />
              )}
              <label className="check nm-me">
                <input type="checkbox" checked={creatorSpeaks} onChange={(e) => setCreatorSpeaks(e.target.checked)} /> {t("creatorSpeaks")}
              </label>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="nm-content stack">
            <section className="nm-pane stack" aria-labelledby="nm-sections">
              <div className="row-between">
                <h3 className="nm-pane-title" id="nm-sections">
                  <ListChecks size={18} strokeWidth={2} aria-hidden="true" /> {t("content.sectionsTitle")}
                </h3>
                <Menu
                  label={t("content.addSection")}
                  className="nm-add"
                  button={
                    <>
                      <Plus size={16} strokeWidth={2.2} aria-hidden="true" /> {t("content.addSection")}
                    </>
                  }
                >
                  {(close) =>
                    (["achievement", "plan", "blocker", "note", "custom"] as const).map((role) => {
                      const RoleIcon = ROLE_ICONS[role];
                      return (
                        <button
                          key={role}
                          type="button"
                          className="menu-item"
                          disabled={role !== "custom" && usedRoles.has(role)}
                          onClick={() => {
                            close();
                            addSection(role);
                          }}
                        >
                          <RoleIcon className={`ico role-ico role-${role}`} size={16} strokeWidth={2} aria-hidden="true" />
                          <span className="menu-item-text">
                            <strong>
                              {role === "custom" ? t("content.custom") : tSections(`defaults.${ROLE_KIND[role]}` as "defaults.done")}
                            </strong>
                            <span className="hint">{t(`content.roleHint.${role}`)}</span>
                          </span>
                        </button>
                      );
                    })
                  }
                </Menu>
              </div>
              <p className="hint">{t("content.sectionsHint")}</p>
              <ol className="nm-sections">
                {sections.map((s, i) => {
                  const RoleIcon = ROLE_ICONS[s.role];
                  return (
                    <li key={s.key} className={`nm-section role-${s.role}`}>
                      <span className="nm-section-icon" aria-hidden="true">
                        <RoleIcon size={17} strokeWidth={2.1} />
                      </span>
                      <label className="nm-section-name">
                        <span className="sr-only">{t("content.sectionLabel")}</span>
                        <Pencil size={13} strokeWidth={2} aria-hidden="true" className="nm-edit-ico" />
                        <input
                          type="text"
                          maxLength={60}
                          value={s.label}
                          placeholder={sectionLabel(s)}
                          onChange={(e) => editSection(i, { label: e.target.value })}
                        />
                      </label>
                      <Select
                        className="compact"
                        aria-label={t("content.sectionType")}
                        value={s.input}
                        onChange={(e) => editSection(i, { input: e.target.value as SectionType })}
                      >
                        {SECTION_TYPES.map((x) => (
                          <option key={x} value={x}>
                            {tSections(`types.${x}.label`)}
                          </option>
                        ))}
                      </Select>
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label={t("content.removeSection", { name: sectionLabel(s) })}
                        disabled={sections.length <= 1}
                        onClick={() => setSections(sections.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
            <section className="nm-pane stack" aria-labelledby="nm-modules">
              <div className="row-between">
                <h3 className="nm-pane-title" id="nm-modules">
                  <SlidersHorizontal size={18} strokeWidth={2} aria-hidden="true" /> {t("modules")}
                </h3>
                <span className="pill view">{t("content.modulesOn", { count: tools.length })}</span>
              </div>
              <p className="hint">{t("content.modulesHint")}</p>
              {MODULE_GROUPS.map((group) => {
                const items = allowed.filter((m) => m.category === group);
                if (!items.length) return null;
                return (
                  <div key={group} className="nm-mod-group">
                    <h4 className="lbl-s">{tModules(`categories.${group}`)}</h4>
                    <ul className="nm-mods">
                      {items.map((m) => (
                        <li key={m.id}>
                          <label className={`nm-mod${mods[m.id] ? " on" : ""}`}>
                            <span className="nm-mod-icon" aria-hidden="true">
                              {m.icon}
                            </span>
                            <span className="nm-mod-text">
                              <strong>{tModules(`items.${m.id}.name` as "items.kudos.name")}</strong>
                              <span className="hint">{tModules(`items.${m.id}.description` as "items.kudos.description")}</span>
                            </span>
                            <span className="switch">
                              <input
                                type="checkbox"
                                checked={!!mods[m.id]}
                                onChange={(e) => setMods({ ...mods, [m.id]: e.target.checked })}
                              />
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          </div>
        )}

        {step === 3 && (
          <div className="nm-review">
            <div className="nm-review-hero">
              <span className="nm-preview-icon" aria-hidden="true">
                {template.ref === blank.ref ? <Plus size={30} strokeWidth={2} /> : template.icon}
              </span>
              <div>
                <h3>{name.trim() || template.name}</h3>
                <p className="hint">{template.ref === blank.ref ? t("blank.name") : t("fromTemplate", { name: template.name })}</p>
              </div>
            </div>
            <dl className="nm-review-grid">
              {[
                {
                  icon: CalendarClock,
                  label: t("schedule"),
                  step: 1 as Step,
                  value: t("recapSchedule", {
                    schedule: describeSchedule([rule], timeZone, locale as Locale, browserTimeZone()),
                    duration: t("minutes", { m: durationMin }),
                    date: fmt.date(firstSession?.date ?? startDate),
                  }),
                },
                {
                  icon: Users,
                  label: t("people"),
                  step: 1 as Step,
                  value: t("recapPeople", { count: picked.size + (creatorSpeaks ? 1 : 0) }),
                },
                ...(firstRound ? [{ icon: ArrowRight, label: t("order.title"), step: 1 as Step, value: t(`order.${firstRound}`) }] : []),
                { icon: ListChecks, label: t("sections"), step: 2 as Step, value: sections.map(sectionLabel).join(" · ") },
                {
                  icon: SlidersHorizontal,
                  label: t("modules"),
                  step: 2 as Step,
                  value: tools.length
                    ? tools.map((m) => `${m.icon} ${tModules(`items.${m.id}.name` as "items.kudos.name")}`).join(" · ")
                    : t("preview.noModules"),
                },
              ].map((row) => (
                <div key={row.label} className="nm-review-row">
                  <dt>
                    <row.icon size={16} strokeWidth={2} aria-hidden="true" /> {row.label}
                  </dt>
                  <dd>{row.value}</dd>
                  {/* In a dd too: a definition list holds only terms and definitions */}
                  <dd className="nm-review-edit">
                    <button type="button" className="btn ghost sm" onClick={() => go(row.step)}>
                      <Pencil size={13} strokeWidth={2} aria-hidden="true" /> {t("edit")}
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="hint">{t("modulesLater")}</p>
          </div>
        )}

        <div className="nm-foot">
          <span className="nm-foot-summary">
            <span className="nm-foot-icon" aria-hidden="true">
              {template.ref === blank.ref ? <Plus size={16} strokeWidth={2.2} /> : template.icon}
            </span>
            <span>
              <strong>{name.trim() || template.name}</strong>
              <span className="hint">{template.ref === blank.ref ? t("blank.meta") : template.schedule}</span>
            </span>
          </span>
          {step === 0 ? (
            <Link href={`/w/${slug}`} className="btn">
              {t("cancel")}
            </Link>
          ) : (
            <button type="button" className="btn" onClick={() => go((step - 1) as Step)}>
              <ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" /> {t("back")}
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy || !valid(step)} aria-busy={busy}>
            {step < 3 ? (
              <>
                {t("next")} <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" />
              </>
            ) : (
              <>
                <Sparkles size={16} strokeWidth={2.2} aria-hidden="true" /> {t("create")}
              </>
            )}
          </button>
        </div>
      </form>
      {confirmDialog}
    </div>
  );
}
