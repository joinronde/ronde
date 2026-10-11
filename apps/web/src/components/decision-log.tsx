"use client";

import type { DecisionDTO } from "@ronde/core/types";
import { formatters } from "@ronde/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { LoadError } from "./common";
import { useRonde } from "./ronde-provider";

/** Decision log: every decision noted in the archived sessions, newest first, searchable */
export function DecisionLog() {
  const t = useTranslations("decisions");
  const locale = useLocale();
  const fmt = formatters(locale);
  const { s, api, historyRev } = useRonde();
  const [items, setItems] = useState<DecisionDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");

  // The search waits for a pause in typing
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim().length >= 2 ? q.trim() : ""), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    let live = true;
    setError(false);
    const params = new URLSearchParams({ locale });
    if (query) params.set("q", query);
    fetch(api(`/decisions?${params}`), { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { items: DecisionDTO[] };
        if (live) setItems(body.items);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [api, locale, query, historyRev, retry]);

  const byDate = useMemo(() => {
    const groups = new Map<string, DecisionDTO[]>();
    for (const d of items ?? []) groups.set(d.date, [...(groups.get(d.date) ?? []), d]);
    return [...groups];
  }, [items]);

  if (!s.modules.decisions) return <div className="emptybox">{t("off")}</div>;
  if (error) return <LoadError onRetry={() => setRetry((n) => n + 1)} />;
  if (!items) return <p className="loading">{t("loading")}</p>;
  if (!items.length && !query)
    return (
      <div className="emptybox">
        <p>{t("empty")}</p>
        <p className="hint">{t("howTo")}</p>
      </div>
    );
  return (
    <div className="decision-log">
      <div className="hist-bar">
        <input
          type="search"
          placeholder={t("searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("searchLabel")}
        />
        <span className="hint" role="status">
          {t("count", { count: items.length })}
        </span>
      </div>
      {!items.length && <div className="emptybox">{t("noMatch", { query })}</div>}
      {byDate.map(([date, list]) => (
        <section key={date} className="decision-day" aria-labelledby={`d-${date}`}>
          <h2 id={`d-${date}`}>{fmt.date(date)}</h2>
          <ul>
            {list.map((d, i) => (
              <li key={`${i}-${d.text}`}>
                <span className="decision-text">{d.text}</span>
                {d.context && <span className="hint">{d.context}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
