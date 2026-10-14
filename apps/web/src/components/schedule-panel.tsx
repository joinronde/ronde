"use client";

import { describeSchedule, localDate, type Occurrence, occurrences, type ScheduleRule } from "@ronde/core/schedule";
import { fmtMinutes } from "@ronde/core/util";
import { formatters } from "@ronde/i18n";
import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { DurationField } from "@/components/duration-field";
import { Select } from "@/components/select";
import { isoDow, newRule, sameDays, withFreq } from "@/lib/shared/schedule";
import { DateInput } from "./date-input";
import { HolidayPicker } from "./holiday-picker";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";
import { TimeZoneSelect } from "./workspace/inputs";

/** How long after the last change the schedule saves itself */
export const SCHEDULE_AUTOSAVE_MS = 1200;

type Draft = ScheduleRule;
type MonthBy = "date" | "weekday" | "last";

const WEEK = [1, 2, 3, 4, 5, 6, 7];
const WORKDAYS = [1, 2, 3, 4, 5];

/** Recurrence of the meeting: rules, then the next dates with what can be done to each one */
export function SchedulePanel() {
  const t = useTranslations("scheduleEditor");
  const locale = useLocale();
  const { s, rpc } = useRonde();
  const saved = s.settings.schedule;
  const [rules, setRulesState] = useState<Draft[]>(saved.rules);
  const [timeZone, setTimeZoneState] = useState(saved.meetingTimeZone ?? "");
  // Changed here and not saved yet
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const setRules = (next: Draft[] | ((list: Draft[]) => Draft[])) => {
    setRulesState(next);
    setEdited(true);
  };
  const setTimeZone = (tz: string) => {
    setTimeZoneState(tz);
    setEdited(true);
  };
  // Saved here, waiting for the saved schedule (with the ids of new rules) to come back from the server
  const [syncing, setSyncing] = useState(false);
  // The saved schedule changed (saved here, or by another host): follow it, unless something is being
  // edited here. After a save, the edited values stay on screen until the saved ones arrive.
  const savedKey = JSON.stringify([saved.rules, saved.meetingTimeZone]);
  useEffect(() => {
    if (edited && !syncing) return;
    const [savedRules, savedZone] = JSON.parse(savedKey) as [Draft[], string | null];
    setRulesState(savedRules);
    setTimeZoneState(savedZone ?? "");
    setEdited(false);
    setSyncing(false);
  }, [savedKey]);
  // Nothing came back (the saved schedule did not change): stop waiting
  useEffect(() => {
    if (!syncing) return;
    const timer = setTimeout(() => {
      setSyncing(false);
      setEdited(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [syncing]);
  const dirty = edited && !syncing && JSON.stringify([rules, timeZone || null]) !== savedKey;

  const effectiveZone = timeZone || saved.timeZone;
  const today = localDate(Date.now(), effectiveZone);
  const summary = useMemo(() => describeSchedule(rules, effectiveZone, locale), [rules, effectiveZone, locale]);
  const patch = (i: number, p: Partial<Draft>) => setRules((list) => list.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const save = async () => {
    setBusy(true);
    const ok = await rpc({ op: "schedule.save", timeZone, rules: rules.map(({ id, ...r }) => ({ ...(id ? { id } : {}), ...r })) });
    setBusy(false);
    if (ok) {
      setSyncing(true);
      setSavedAt(Date.now());
    }
  };
  // Saved by itself, like the other settings: a moment after the last change, once every field reads well
  const panel = useRef<HTMLDivElement>(null);
  const [savedAt, setSavedAt] = useState(0);
  const draftKey = JSON.stringify([rules, timeZone]);
  // Runs again on each change of the draft, so the save sends the draft as it stands when the delay ends
  useEffect(() => {
    if (!dirty || busy) return;
    const timer = setTimeout(() => {
      if (!panel.current?.querySelector(":invalid")) void save();
    }, SCHEDULE_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draftKey, dirty, busy]);

  // One weekly rule: offer to alternate two times, one week apart
  const one = rules.length === 1 && rules[0]!.freq === "weekly" ? rules[0]! : null;
  const alternate = () => {
    if (!one) return;
    const later = new Date(Date.parse(`${one.startDate}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const [h = 10, m = 0] = one.time.split(":").map(Number);
    const other = `${String(Math.min(23, h + 5)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    setRules([
      { ...one, interval: 2 },
      { ...one, id: "", interval: 2, startDate: later, time: other },
    ]);
  };

  return (
    <div className="panel form" id="schedule" ref={panel}>
      <p className="schedule-summary" aria-live="polite">
        {summary}
      </p>
      <ol className="rule-list">
        {rules.map((r, i) => (
          <RuleEditor
            key={r.id || `new-${i}`}
            rule={r}
            index={i}
            onChange={(p) => patch(i, p)}
            onRemove={rules.length > 1 ? () => setRules(rules.filter((_, j) => j !== i)) : undefined}
          />
        ))}
      </ol>
      <div className="controls">
        <button
          type="button"
          className="btn"
          onClick={() => setRules([...rules, newRule(today, rules.at(-1)?.time)])}
          disabled={rules.length >= 8}
        >
          + {t("addPattern")}
        </button>
        {one && (
          <button type="button" className="btn" onClick={alternate}>
            ⇄ {t("alternate")}
          </button>
        )}
      </div>
      <div className="field">
        <label htmlFor="sZone">{t("timeZone")}</label>
        <TimeZoneSelect
          id="sZone"
          value={timeZone}
          emptyLabel={t("workspaceZone", { zone: s.settings.schedule.timeZone })}
          onChange={setTimeZone}
        />
      </div>
      <p className={`schedule-status${dirty || busy ? " is-saving" : ""}`} role="status" aria-live="polite">
        {dirty || busy ? t("saving") : savedAt ? t("saved") : ""}
      </p>
      <Holidays />
      <Upcoming rules={rules} timeZone={effectiveZone} editable={!dirty} />
    </div>
  );
}

/** The public holidays that skip sessions: saved at once, the dates below follow */
function Holidays() {
  const t = useTranslations("holidays");
  const { s, rpc } = useRonde();
  const h = s.settings.schedule.holidays;
  const [busy, setBusy] = useState(false);
  const change = async (value: string) => {
    setBusy(true);
    await rpc({ op: "schedule.holidays", value: value === "" ? null : value }, t("saved"));
    setBusy(false);
  };
  return (
    <div className="field holidays-field">
      <label htmlFor="sHolidays">{t("label")}</label>
      <HolidayPicker
        id="sHolidays"
        value={h.value ?? ""}
        onChange={change}
        countries={h.countries}
        regions={h.regions}
        workspace={h.workspace}
        disabled={busy}
      />
      <p className="hint">
        {t("hintMeeting")} <span className="holiday-source">{t("source")}</span>
      </p>
    </div>
  );
}

function RuleEditor({
  rule: r,
  index,
  onChange,
  onRemove,
}: {
  rule: Draft;
  index: number;
  onChange: (p: Partial<Draft>) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("scheduleEditor");
  const locale = useLocale();
  const fmt = formatters(locale);
  const tm = useTranslations("settings.meeting");
  const id = `rule${index}`;
  const end = r.until ? "until" : r.count ? "count" : "never";
  const monthBy: MonthBy = r.monthDay === -1 ? "last" : r.setPos ? "weekday" : "date";
  const dayLabel = (d: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, d)));
  // Daily without a filter means every day: all the days show on
  const shownDays = r.freq === "daily" && !r.byDay.length ? WEEK : r.byDay;
  const toggleDay = (d: number) => {
    const next = shownDays.includes(d) ? shownDays.filter((x) => x !== d) : [...shownDays, d].sort();
    // One day at least; every day of the week is no filter at all
    if (!next.length) return;
    onChange({ byDay: r.freq === "daily" && next.length === 7 ? [] : next });
  };
  return (
    <li className="rule">
      <div className="rule-head">
        <span className="eyebrow">{t("pattern", { n: index + 1 })}</span>
        <span className="rule-says">{describeSchedule([r], "UTC", locale, "UTC")}</span>
        {onRemove && (
          <button type="button" className="icon-btn danger" onClick={onRemove} aria-label={t("removePattern", { n: index + 1 })}>
            <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="rule-grid">
        <div className="field">
          <label htmlFor={`${id}-freq`}>{t("frequency")}</label>
          <Select id={`${id}-freq`} value={r.freq} onChange={(e) => onChange(withFreq(r, e.target.value as Draft["freq"]))}>
            {(["daily", "weekly", "monthly"] as const).map((f) => (
              <option key={f} value={f}>
                {t(`freqs.${f}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-every`}>{t("interval", { freq: r.freq })}</label>
          <div className="input-unit">
            <input
              id={`${id}-every`}
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={r.interval}
              onChange={(e) => onChange({ interval: Math.min(99, Math.max(1, Math.round(Number(e.target.value)) || 1)) })}
            />
            <span>{t(`units.${r.freq}`, { count: r.interval })}</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${id}-time`}>{t("time")}</label>
          <input id={`${id}-time`} type="time" required value={r.time} onChange={(e) => onChange({ time: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-duration`}>{t("duration")}</label>
          <DurationField
            id={`${id}-duration`}
            value={r.durationMin}
            unit="minutes"
            presets={[10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480]}
            min={5}
            max={480}
            format={(v) => fmtMinutes(v, locale)}
            onChange={(v) => onChange({ durationMin: v })}
            labels={{
              custom: tm("otherDuration"),
              big: tm("hours"),
              small: tm("minutes"),
              bigUnit: tm("unitH"),
              smallUnit: tm("unitMin"),
              range: tm("targetRange"),
            }}
          />
        </div>
      </div>
      {r.freq !== "monthly" && (
        <fieldset className="plain">
          <legend className="lbl-s">{r.freq === "weekly" ? t("onDays") : t("onlyDays")}</legend>
          <div className="day-row">
            <div className="day-chips">
              {WEEK.map((d) => (
                <button key={d} type="button" className="chip" aria-pressed={shownDays.includes(d)} onClick={() => toggleDay(d)}>
                  {dayLabel(d)}
                </button>
              ))}
            </div>
            <div className="day-quick">
              <button type="button" onClick={() => onChange({ byDay: WORKDAYS })} disabled={sameDays(r.byDay, WORKDAYS)}>
                {t("workdays")}
              </button>
              {r.freq === "daily" && (
                <button type="button" onClick={() => onChange({ byDay: [] })} disabled={!r.byDay.length}>
                  {t("allDays")}
                </button>
              )}
            </div>
          </div>
        </fieldset>
      )}
      {r.freq === "monthly" && (
        <fieldset className="plain month-by">
          <legend className="lbl-s">{t("monthBy")}</legend>
          <label className="month-option">
            <input
              type="radio"
              name={`${id}-monthBy`}
              checked={monthBy === "date"}
              onChange={() => onChange({ setPos: null, byDay: [], monthDay: Number(r.startDate.slice(8)) })}
            />
            {t("monthDate") && <span>{t("monthDate")}</span>}
            <input
              type="number"
              min={1}
              max={31}
              aria-label={t("dayOfMonth")}
              disabled={monthBy !== "date"}
              value={monthBy === "date" ? (r.monthDay ?? 1) : Number(r.startDate.slice(8))}
              onChange={(e) => onChange({ monthDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
            />
            {t("monthDateAfter") && <span>{t("monthDateAfter")}</span>}
            {monthBy === "date" && (r.monthDay ?? 1) > 28 && <span className="hint">{t("shortMonths")}</span>}
          </label>
          <label className="month-option">
            <input
              type="radio"
              name={`${id}-monthBy`}
              checked={monthBy === "weekday"}
              onChange={() =>
                onChange({ monthDay: null, byDay: [isoDow(r.startDate)], setPos: Math.min(4, Math.ceil(Number(r.startDate.slice(8)) / 7)) })
              }
            />
            <span>{t("monthWeekday")}</span>
            <Select
              aria-label={t("which")}
              disabled={monthBy !== "weekday"}
              value={r.setPos ?? 1}
              onChange={(e) => onChange({ setPos: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, -1].map((n) => (
                <option key={n} value={n}>
                  {t(`ordinals.${n === -1 ? "last" : n}` as "ordinals.1")}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("weekday")}
              disabled={monthBy !== "weekday"}
              value={r.byDay[0] ?? isoDow(r.startDate)}
              onChange={(e) => onChange({ byDay: [Number(e.target.value)] })}
            >
              {WEEK.map((d) => (
                <option key={d} value={d}>
                  {fmt.weekday(d % 7)}
                </option>
              ))}
            </Select>
          </label>
          <label className="month-option">
            <input
              type="radio"
              name={`${id}-monthBy`}
              checked={monthBy === "last"}
              onChange={() => onChange({ setPos: null, byDay: [], monthDay: -1 })}
            />
            <span>{t("monthLast")}</span>
          </label>
        </fieldset>
      )}
      <div className="rule-grid">
        <div className="field">
          <label htmlFor={`${id}-start`}>{t("startsOn")}</label>
          <DateInput id={`${id}-start`} required compact value={r.startDate} onChange={(v) => v && onChange({ startDate: v })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-end`}>{t("ends")}</label>
          <Select
            id={`${id}-end`}
            value={end}
            onChange={(e) =>
              onChange(
                e.target.value === "until"
                  ? { until: r.startDate, count: null }
                  : e.target.value === "count"
                    ? { count: 10, until: null }
                    : { until: null, count: null },
              )
            }
          >
            <option value="never">{t("endNever")}</option>
            <option value="until">{t("endOn")}</option>
            <option value="count">{t("endAfter")}</option>
          </Select>
        </div>
        {end === "until" && (
          <div className="field">
            <label htmlFor={`${id}-until`}>{t("lastDate")}</label>
            <DateInput
              id={`${id}-until`}
              compact
              min={r.startDate}
              value={r.until ?? ""}
              onChange={(v) => onChange({ until: v || null })}
            />
          </div>
        )}
        {end === "count" && (
          <div className="field">
            <label htmlFor={`${id}-count`}>{t("occurrences")}</label>
            <input
              id={`${id}-count`}
              type="number"
              min={1}
              max={500}
              value={r.count ?? 1}
              onChange={(e) => onChange({ count: Math.min(500, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </div>
        )}
      </div>
    </li>
  );
}

/** Next 8 dates; once the schedule is saved, each one can be skipped, moved or given another time */
function Upcoming({ rules, timeZone, editable }: { rules: Draft[]; timeZone: string; editable: boolean }) {
  const t = useTranslations("scheduleEditor");
  const tHolidays = useTranslations("holidays");
  const locale = useLocale();
  const fmt = formatters(locale);
  const { s, rpc } = useRonde();
  const [moving, setMoving] = useState<string | null>(null);
  const from = localDate(Date.now(), timeZone);
  // Saved: the server's list (exceptions included); being edited: computed here, without actions
  const list: Occurrence[] = editable
    ? s.settings.schedule.upcoming
    : occurrences(rules, s.settings.schedule.exceptions, timeZone, {
        from,
        to: new Date(Date.parse(`${from}T12:00:00Z`) + 400 * 86_400_000).toISOString().slice(0, 10),
        withCancelled: true,
      }).slice(0, 8);
  const declined = (key: string) => Object.values(s.attendance[key] ?? {}).filter((x) => x === "no").length;
  return (
    <section className="upcoming" aria-labelledby="upcoming-title">
      <h4 id="upcoming-title" className="eyebrow">
        {t("upcoming")}
      </h4>
      {!editable && <p className="hint">{t("saveToEdit")}</p>}
      {list.length === 0 ? (
        <p className="empty-state">{t("noDate")}</p>
      ) : (
        <ul className="occ-list">
          {list.map((o) => (
            <li key={o.key} className={o.cancelled ? "cancelled" : o.moved ? "moved" : undefined}>
              <span className="occ-when">
                {/* The day and its time together: the row's gap is for what follows them */}
                <span>
                  <strong>{fmt.dateShort(o.date)}</strong> · {o.time}
                </span>
                {o.moved && <span className="st-pill st-doing">{t("moved")}</span>}
                {o.cancelled && o.holiday ? (
                  <span className="st-pill holiday-pill">{tHolidays("skipped", { name: o.holiday })}</span>
                ) : (
                  o.cancelled && <span className="st-pill st-open">{t("cancelled")}</span>
                )}
                {o.kept && o.holiday && <span className="st-pill st-done">{tHolidays("kept", { name: o.holiday })}</span>}
                {s.meeting?.occurrenceKey === o.key && <span className="st-pill st-done">{t("current")}</span>}
                {declined(o.key) > 0 && <span className="hint">{t("declined", { count: declined(o.key) })}</span>}
                {!o.cancelled &&
                  (s.settings.schedule.conflicts[o.key] ?? []).map((c) => (
                    <span key={c.meeting} className="occ-conflict" title={c.names.join(", ")}>
                      <Icon name="alert" size={14} />{" "}
                      {t("conflict", { meeting: c.meeting, names: c.names.slice(0, 3).join(", "), more: Math.max(0, c.names.length - 3) })}
                    </span>
                  ))}
              </span>
              {editable && (
                <span className="occ-actions">
                  {o.cancelled && o.holiday ? (
                    // Skipped for a public holiday: held anyway, or moved to another day
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => rpc({ op: "schedule.keep", key: o.key }, tHolidays("held"))}
                      >
                        {tHolidays("keep")}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setMoving(moving === o.key ? null : o.key)}
                        aria-expanded={moving === o.key}
                      >
                        {t("move")}
                      </button>
                    </>
                  ) : o.cancelled ? (
                    <button type="button" className="icon-btn" onClick={() => rpc({ op: "schedule.restore", key: o.key }, t("restored"))}>
                      {t("restore")}
                    </button>
                  ) : o.kept ? (
                    <button type="button" className="icon-btn" onClick={() => rpc({ op: "schedule.restore", key: o.key }, t("skipped"))}>
                      {tHolidays("skipAgain")}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setMoving(moving === o.key ? null : o.key)}
                        aria-expanded={moving === o.key}
                      >
                        {t("move")}
                      </button>
                      <button type="button" className="icon-btn" onClick={() => rpc({ op: "schedule.skip", key: o.key }, t("skipped"))}>
                        {t("skip")}
                      </button>
                    </>
                  )}
                  {o.moved && !o.cancelled && (
                    <button type="button" className="icon-btn" onClick={() => rpc({ op: "schedule.restore", key: o.key }, t("restored"))}>
                      {t("reset")}
                    </button>
                  )}
                </span>
              )}
              {moving === o.key && <MoveForm occurrence={o} onDone={() => setMoving(null)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MoveForm({ occurrence: o, onDone }: { occurrence: Occurrence; onDone: () => void }) {
  const t = useTranslations("scheduleEditor");
  const { rpc } = useRonde();
  const [date, setDate] = useState(o.date);
  const [time, setTime] = useState(o.time);
  return (
    <form
      className="move-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await rpc({ op: "schedule.move", key: o.key, date, time, durationMin: null }, t("movedTo"))) onDone();
      }}
    >
      <label className="sr-only" htmlFor={`mv-d-${o.key}`}>
        {t("newDate")}
      </label>
      <DateInput id={`mv-d-${o.key}`} required compact className="auto" value={date} onChange={setDate} />
      <label className="sr-only" htmlFor={`mv-t-${o.key}`}>
        {t("newTime")}
      </label>
      <input id={`mv-t-${o.key}`} type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
      <button type="submit" className="btn primary sm">
        {t("apply")}
      </button>
      <button type="button" className="btn sm" onClick={onDone}>
        {t("cancel")}
      </button>
    </form>
  );
}
