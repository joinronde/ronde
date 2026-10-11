"use client";

import { type ResolvedAmbience, resolveAmbience } from "@ronde/core/ambience";
import { motionAllowed } from "@ronde/ui/effects";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { useRonde } from "./ronde-provider";

export const AMBIENCE_KEY = "ronde.ambience";

export const readAmbienceChoice = () => {
  try {
    return localStorage.getItem(AMBIENCE_KEY) ?? "auto";
  } catch {
    return "auto";
  }
};

/** Ambience theme picked in this browser (shared-screen menu), followed from one tab to another */
export function useAmbience(): { ambience: ResolvedAmbience | null; motion: boolean } {
  const locale = useLocale();
  const { s, hydrated, now, mod } = useRonde();
  const [choice, setChoice] = useState<string | null>(null);
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const sync = () => {
      setChoice(readAmbienceChoice());
      setMotion(motionAllowed());
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("ronde-ambience", sync);
    // "Reduced motion" is set through the body class
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("ronde-ambience", sync);
      mo.disconnect();
    };
  }, []);
  // Browser date: nothing before load, so the server and the browser agree
  if (!hydrated || choice === null) return { ambience: null, motion: false };
  // Only members of the round table are celebrated
  const present = s.members.filter((m) => m.active);
  const ambience = resolveAmbience(choice, new Date(now()), locale, present);
  // Seasonal decorations belong to the ambience module; a birthday is celebrated by the birthdays module
  if (ambience && ambience.key !== "birthday" && !mod("ambience")) return { ambience: null, motion };
  return { ambience, motion };
}

/** Stable pseudo-randomness: particles keep their place from one render to the next */
const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Theme particles, behind the content of the waiting screen */
export function AmbienceLayer({ ambience, count = 18 }: { ambience: ResolvedAmbience; count?: number }) {
  return (
    <div className={"ambience am-" + ambience.motion} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={ambience.key + i}
          style={
            {
              "--x": (rnd(i, 1) * 100).toFixed(1) + "%",
              "--y": (rnd(i, 5) * 90).toFixed(1) + "%",
              "--s": (0.8 + rnd(i, 2) * 1.2).toFixed(2),
              "--t": (9 + rnd(i, 3) * 10).toFixed(1) + "s",
              "--d": (-rnd(i, 4) * 18).toFixed(1) + "s",
              "--dx": ((rnd(i, 6) - 0.5) * 16).toFixed(1) + "em",
              "--r": ((rnd(i, 7) - 0.5) * 720).toFixed(0) + "deg",
            } as React.CSSProperties
          }
        >
          {ambience.particles[i % ambience.particles.length]}
        </span>
      ))}
    </div>
  );
}
