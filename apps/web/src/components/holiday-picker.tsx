"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Select } from "./select";

/** The name of a holiday calendar in the reader's language: "France", "Germany · Bayern" */
export function holidayName(code: string | null, locale: string, regions: Record<string, string> = {}): string {
  if (!code) return "";
  const [country = "", region] = code.split("-");
  let name = country;
  try {
    name = new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country;
  } catch {
    // An old browser without region names: the code
  }
  return region ? `${name} · ${regions[region] ?? region}` : name;
}

/**
 * Which public holidays skip the sessions: a country, then one of its regions when their holidays differ.
 * On a meeting, the first choice follows the workspace and "none" turns them off; on the workspace, "" is none.
 * The regions listed are the ones of the country saved (they come back with it).
 */
export function HolidayPicker({
  id,
  value,
  onChange,
  countries,
  regions,
  workspace,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  countries: string[];
  regions: Record<string, string>;
  /** On a meeting: the workspace's calendar (null: none), offered as the first choice */
  workspace?: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations("holidays");
  const locale = useLocale();
  const sorted = useMemo(
    () => countries.map((code) => ({ code, name: holidayName(code, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [countries, locale],
  );
  const meeting = workspace !== undefined;
  const [country = "", region = ""] = value === "none" ? ["none"] : value.split("-");
  const regionList = Object.entries(regions).sort((a, b) => a[1].localeCompare(b[1], locale));
  const showRegions = country && country !== "none" && regionList.length > 0;
  return (
    <div className="holiday-picker">
      <Select id={id} value={country} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {meeting ? (
          <>
            <option value="">{workspace ? t("inherit", { name: holidayName(workspace, locale, regions) }) : t("inheritNone")}</option>
            <option value="none">{t("noneMeeting")}</option>
          </>
        ) : (
          <option value="">{t("none")}</option>
        )}
        {sorted.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </Select>
      {showRegions && (
        <Select
          aria-label={t("region")}
          value={region}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value ? `${country}-${e.target.value}` : country)}
        >
          <option value="">{t("wholeCountry")}</option>
          {regionList.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
