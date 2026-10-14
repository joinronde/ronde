"use client";

import { FEATURES, hasFeature } from "@ronde/editions";
import { MODULE_CATEGORIES } from "@ronde/module-sdk";
import { CATALOG, PAID_MODULES } from "@ronde/modules/catalog";
import { useTranslations } from "next-intl";
import { useRonde } from "./ronde-provider";
import { NewTab } from "./shell/new-tab";

/** Module catalog of a meeting: what it uses, turned on or off; paid modules shown locked to admins */
export function ModulesPanel() {
  const t = useTranslations("modules");
  const { s, rpc } = useRonde();
  const toggle = (id: string, enabled: boolean) => {
    const name = t(`items.${id}.name` as "items.kudos.name");
    void rpc({ op: "modules.set", moduleId: id, enabled }, enabled ? t("enabled", { name }) : t("disabled", { name }), {
      tone: enabled ? "ok" : "off",
    });
  };
  return (
    <div className="panel form">
      <p className="hint">{t("intro")}</p>
      {MODULE_CATEGORIES.map((category) => {
        const list = CATALOG.filter((m) => m.category === category);
        if (!list.length) return null;
        return (
          <section key={category} className="mod-group" aria-labelledby={`mod-${category}`}>
            <h4 id={`mod-${category}`} className="eyebrow">
              {t(`categories.${category}`)}
            </h4>
            <ul className="mod-list">
              {list.map((m) => {
                const on = !!s.modules[m.id];
                const name = t(`items.${m.id}.name` as "items.kudos.name");
                return (
                  <li key={m.id}>
                    {/* The whole row turns the module on or off, read from the left; its state sits by the switch */}
                    <label className={`mod toggle-row ${on ? "on" : ""}`}>
                      <span className="mod-icon" aria-hidden="true">
                        {m.icon}
                      </span>
                      <span className="mod-text">
                        <strong>{name}</strong>
                        <span className="hint" id={`mod-desc-${m.id}`}>
                          {t(`items.${m.id}.description` as "items.kudos.description")}
                        </span>
                      </span>
                      <span className="mod-state" aria-hidden="true">
                        {on ? t("on") : t("off")}
                      </span>
                      <span className="switch">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={on}
                          aria-label={t("toggle", { name })}
                          aria-describedby={`mod-desc-${m.id}`}
                          onChange={(e) => toggle(m.id, e.target.checked)}
                        />
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {/* What the paid plans add, after the modules of this edition: to administrators, while the suggestions are on */}
      {s.upgradeHints && PAID_MODULES.some((m) => !hasFeature(s.edition, m.feature)) && (
        <section className="mod-group paid" aria-labelledby="mod-paid">
          <h4 id="mod-paid" className="eyebrow">
            {t("paidTitle")}
          </h4>
          <p className="hint">{t("paidIntro")}</p>
          <ul className="mod-list">
            {PAID_MODULES.filter((m) => !hasFeature(s.edition, m.feature)).map((m) => (
              <li key={m.id} className="mod locked">
                <span className="mod-icon" aria-hidden="true">
                  {m.icon}
                </span>
                <span className="mod-text">
                  <strong>{t(`items.${m.id}.name` as "items.kudos.name")}</strong>
                  <span className="hint">{t(`items.${m.id}.description` as "items.kudos.description")}</span>
                </span>
                <span className="plan-badge">{t(`editions.${FEATURES[m.feature].edition as "team" | "enterprise"}`)}</span>
              </li>
            ))}
          </ul>
          <a className="link" href={s.upgradeHints} target="_blank" rel="noopener">
            {t("learnMore")}
            <NewTab />
          </a>
        </section>
      )}
    </div>
  );
}
