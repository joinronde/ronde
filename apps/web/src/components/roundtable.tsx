"use client";

import { first } from "@ronde/core/util";
import { useTranslations } from "next-intl";
import { useRonde } from "./ronde-provider";
import { Avatar } from "./stage";

/**
 * The round table: the team placed around the logo ring, in speaking order, the first one at the top. Nobody
 * moves: the orange arc grows round the ring as the turn goes, from the first seat to the person speaking.
 * - intro: plays the opening sequence (the ring draws itself, everyone takes their seat)
 * - focusId: the person who has the floor; the people before them have had their turn
 * - ready: green dot for filled-in check-ins (waiting screen)
 */
export function RoundTable({
  ids,
  focusId,
  intro,
  ready,
  numbered,
  names = true,
  center,
}: {
  ids: string[];
  focusId?: string | null;
  intro?: boolean;
  ready?: Record<string, boolean>;
  numbered?: boolean;
  names?: boolean;
  center?: React.ReactNode;
}) {
  const t = useTranslations("stage");
  const { members } = useRonde();
  const n = Math.max(ids.length, 1);
  const step = 360 / n;
  const focusIdx = focusId ? ids.indexOf(focusId) : -1;
  // Share of the ring already gone round: up to the seat of the person speaking
  const progress = focusIdx > 0 ? (focusIdx / n) * 100 : 0;
  const R = 44; // radius in % of the container
  return (
    <div className={"rt" + (intro ? " intro" : "")} style={{ "--n": n } as React.CSSProperties}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="rt-ring" cx="50" cy="50" r="30" pathLength={1000} />
        <circle
          className="rt-arc"
          cx="50"
          cy="50"
          r="30"
          pathLength={100}
          transform="rotate(-90 50 50)"
          style={{ strokeDasharray: `${progress} 100`, opacity: progress ? 1 : 0 }}
        />
      </svg>
      {ids.map((id, i) => {
        const a = ((i * step - 90) * Math.PI) / 180;
        const m = members[id];
        const state = focusIdx < 0 ? "" : i === focusIdx ? " on" : i < focusIdx ? " done" : " next";
        return (
          <div
            key={id}
            className={"seat" + state}
            style={{ left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%`, "--i": i } as React.CSSProperties}
          >
            <div>
              {i === focusIdx && <span className="pulse" />}
              <Avatar id={id} />
              {numbered && <span className="num">{i + 1}</span>}
              {ready && <span className={"ready" + (ready[id] ? " ok" : "")} title={ready[id] ? t("checkInFilled") : t("checkInEmpty")} />}
              {names && <span className="nm">{first(m?.name)}</span>}
            </div>
          </div>
        );
      })}
      {center && <div className="rt-center">{center}</div>}
    </div>
  );
}
