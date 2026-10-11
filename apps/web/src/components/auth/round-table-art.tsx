"use client";

import { useEffect, useRef, useState } from "react";

// The round table seen from above: the turn goes round, each speaker's timer runs down in the middle.
// Pure decoration for the sign-in pages (hidden from assistive technologies); still with reduced motion.

const R = 118;
/** How long each person keeps the floor here, and the speaking time they start from: time runs at its real pace */
const TURN_MS = 8000;
const SPEAK_S = 120;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The people round the table, their faces drawn on the server */
export function RoundTableArt({ faces }: { faces: { name: string; src: string }[] }) {
  const seats = faces;
  const [speaker, setSpeaker] = useState(2);
  // The timer is written straight into the drawing: re-rendering several times a second would keep
  // interrupting page navigations on a busy device
  const time = useRef<SVGTextElement>(null);
  // The arc grows with the turn, written with the timer: the time gone round the table, up to the speaker
  const arc = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const setLeft = (s: number) => {
      if (time.current) time.current.textContent = mmss(s);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let start = performance.now();
    let current = 2;
    const id = window.setInterval(() => {
      let t = performance.now() - start;
      if (t >= TURN_MS) {
        current = (current + 1) % seats.length;
        setSpeaker(current);
        start = performance.now();
        t = 0;
      }
      setLeft(SPEAK_S - t / 1000);
      if (arc.current) {
        // A new round starts empty, without sweeping back over the ring
        arc.current.style.transition = current === 0 && t === 0 ? "none" : "";
        arc.current.style.strokeDasharray = `${(((current + t / TURN_MS) / seats.length) * 100).toFixed(2)} 100`;
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  // Before the timer runs (and with reduced motion): the arc stops in the first turn shown. A constant, so a
  // re-render never overwrites what the timer draws
  const done = ((2 + 0.35) / seats.length) * 100;
  return (
    <svg className="rt-art" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
      <circle className="rt-art-ring" cx="160" cy="160" r={R} />
      <circle
        ref={arc}
        className="rt-art-arc"
        cx="160"
        cy="160"
        r={R}
        pathLength="100"
        transform="rotate(-90 160 160)"
        style={{ strokeDasharray: `${done} 100` }}
      />
      {seats.map((p, i) => {
        const a = (i / seats.length) * Math.PI * 2 - Math.PI / 2;
        const x = 160 + Math.cos(a) * R;
        const y = 160 + Math.sin(a) * R;
        const state = i === speaker ? " on" : i < speaker ? " done" : "";
        return (
          <g key={p.name} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            {/* The ring grows outside the seat, so the seat itself never moves */}
            {i === speaker && <circle className="rt-art-pulse" r="25" />}
            <g className={`rt-art-seat${state}`}>
              <circle className="rt-art-halo" r="25" />
              <image href={p.src} x="-23" y="-23" width="46" height="46" />
            </g>
          </g>
        );
      })}
      <text className="rt-art-time" x="160" y="168" ref={time}>
        2:00
      </text>
      <text className="rt-art-who" x="160" y="198">
        {seats[speaker]!.name}
      </text>
    </svg>
  );
}
