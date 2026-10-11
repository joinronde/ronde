"use client";

import { type Locale, localeNames, locales } from "@ronde/i18n";
import { useEffect, useMemo, useState } from "react";
import { Select, type SelectProps } from "@/components/select";

/** Browser time zone, e.g. "Europe/Paris" */
export const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** IANA time zone picker; the list comes from the browser */
export function TimeZoneSelect({
  value,
  onChange,
  emptyLabel,
  ...props
}: { value: string; onChange: (tz: string) => void; emptyLabel?: string } & Omit<SelectProps, "value" | "onChange" | "children">) {
  const [zones, setZones] = useState<string[]>([]);
  useEffect(() => {
    try {
      setZones(Intl.supportedValuesOf("timeZone"));
    } catch {
      setZones(["UTC"]);
    }
  }, []);
  const options = useMemo(() => (value && !zones.includes(value) ? [value, ...zones] : zones), [value, zones]);
  return (
    <Select {...props} value={value} onChange={(e) => onChange(e.target.value)}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((tz) => (
        <option key={tz} value={tz}>
          {tz.replaceAll("_", " ")}
        </option>
      ))}
    </Select>
  );
}

export function LocaleSelect({
  value,
  onChange,
  emptyLabel,
  ...props
}: { value: string; onChange: (locale: Locale | "") => void; emptyLabel?: string } & Omit<SelectProps, "value" | "onChange" | "children">) {
  return (
    <Select {...props} value={value} onChange={(e) => onChange(e.target.value as Locale | "")}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {locales.map((l) => (
        <option key={l} value={l} lang={l}>
          {localeNames[l]}
        </option>
      ))}
    </Select>
  );
}
