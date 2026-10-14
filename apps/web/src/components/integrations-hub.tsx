"use client";

import { ArrowRight, ChevronDown, CircleCheck, CircleDashed, CircleOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

// The meeting's integrations at a glance: one card each with where it stands (connected, to set up, off). A
// card set up here opens its panel under the cards; the others lead to the part of the settings that has them.

export interface IntegrationItem {
  id: string;
  name: string;
  mark: React.ReactNode;
  description: string;
  state: "on" | "todo" | "off";
  stateText: string;
  /** Where the access comes from: the workspace, the meeting's own, the server */
  origin?: string;
  /** Set up here: the panel the card opens */
  panel?: React.ReactNode;
  /** Set up in another part of the settings (its category) */
  goTo?: string;
  goToLabel?: string;
}

const STATE_ICON = { on: CircleCheck, todo: CircleDashed, off: CircleOff } as const;

export function IntegrationsHub({ items }: { items: IntegrationItem[] }) {
  const t = useTranslations("settings.hub");
  const [open, setOpen] = useState<string | null>(null);
  // Back from connecting a tool (?gitlab=connected): its card opens
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const back = items.find((it) => it.panel && q.has(it.id));
    if (back) setOpen(back.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const opened = items.find((it) => it.id === open && it.panel);
  return (
    <>
      <div className="panel integ-hub">
        <p className="hint">{t("intro")}</p>
        <div className="integ-grid">
          {items.map((it) => {
            const StateIcon = STATE_ICON[it.state];
            const body = (
              <>
                <span className="integ-top">
                  <span className="integ-mark" aria-hidden="true">
                    {it.mark}
                  </span>
                  <strong className="integ-name">{it.name}</strong>
                  <span className={`integ-state s-${it.state}`}>
                    <StateIcon size={13} strokeWidth={2.4} aria-hidden="true" />
                    {it.stateText}
                  </span>
                </span>
                <span className="integ-desc">{it.description}</span>
                {it.origin && <span className="integ-origin">{it.origin}</span>}
              </>
            );
            return it.panel ? (
              <button
                key={it.id}
                type="button"
                className={`integ-card s-${it.state}${open === it.id ? " open" : ""}`}
                aria-expanded={open === it.id}
                aria-controls={`integ-${it.id}`}
                onClick={() => setOpen(open === it.id ? null : it.id)}
              >
                {body}
                <span className="integ-go">
                  {open === it.id ? t("close") : t("configure")}
                  <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" className="integ-chev" />
                </span>
              </button>
            ) : (
              <a key={it.id} className={`integ-card s-${it.state}`} href={`#${it.goTo ?? ""}`}>
                {body}
                {it.goToLabel && (
                  <span className="integ-go">
                    {it.goToLabel}
                    <ArrowRight size={14} strokeWidth={2.4} aria-hidden="true" className="flip-rtl" />
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </div>
      {opened && (
        <div id={`integ-${opened.id}`} className="integ-detail">
          {opened.panel}
        </div>
      )}
    </>
  );
}
