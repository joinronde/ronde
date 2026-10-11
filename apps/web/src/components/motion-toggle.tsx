"use client";

import { useTranslations } from "next-intl";
import { useLayoutEffect, useState } from "react";
import { Icon } from "./shell/icons";

/**
 * "My screen": animations on or off in this browser, like the sounds. Off, the page moves nothing on its own
 * (the same reduced motion as the projection tab's setting: entrances, flying reactions, confetti…).
 */
const KEY = "ronde.calm.me";

const load = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function MotionToggle() {
  const t = useTranslations("me");
  // null until read from this browser (the server does not know it)
  const [saved, setSaved] = useState<boolean | null>(null);
  const calm = !!saved;
  // Before the page's other effects: what checks the setting as it appears (tab row, count-ups) already sees it
  useLayoutEffect(() => {
    const on = load();
    document.body.classList.toggle("calm", on);
    setSaved(on);
  }, []);
  useLayoutEffect(() => {
    if (saved === null) return;
    document.body.classList.toggle("calm", saved);
    return () => document.body.classList.remove("calm");
  }, [saved]);
  return (
    <span className="my-sound my-motion">
      <button
        type="button"
        aria-pressed={!calm}
        title={calm ? t("motionOnHint") : t("motionOffHint")}
        onClick={() => {
          const next = !calm;
          setSaved(next);
          try {
            localStorage.setItem(KEY, next ? "1" : "0");
          } catch {
            /* storage unavailable: the choice lasts until the page is left */
          }
        }}
      >
        <Icon name="sparkles" size={15} />
        {calm ? t("motionOff") : t("motionOn")}
      </button>
    </span>
  );
}
