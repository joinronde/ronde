import { roundTableFaces } from "./faces";

/**
 * The picture of a page not found: Ronde's round table, the floor going round. The orange arc grows from the
 * first seat, each face lights up as it reaches them, and it ends on an empty seat with a question mark: the page
 * is not at the table. Then a new round. Pure SVG and CSS (server-rendered, no script); with reduced motion it
 * stays on the empty seat. Decoration: hidden from assistive technologies.
 */

const R = 118;
const SEATS = 6;
/** One round, in seconds, and when the arc reaches each seat (share of the round) */
const ROUND = 9;
const reach = (i: number) => 0.06 + i * 0.12;

const at = (i: number) => {
  const a = (i / SEATS) * Math.PI * 2 - Math.PI / 2;
  return { x: 160 + Math.cos(a) * R, y: 160 + Math.sin(a) * R };
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Each face: quiet until the arc reaches it, a pop, then marked as having spoken until the round restarts */
const seatKeyframes = Array.from({ length: SEATS - 1 }, (_, i) => {
  const t = reach(i);
  return `@keyframes lt-seat-${i}{0%,${pct(t - 0.01)}{transform:scale(1)}${pct(t + 0.02)}{transform:scale(1.18)}${pct(t + 0.08)},88%{transform:scale(1)}100%{transform:scale(1)}}
@keyframes lt-halo-${i}{0%,${pct(t - 0.01)}{stroke:var(--line)}${pct(t + 0.02)},88%{stroke:var(--accent)}96%,100%{stroke:var(--line)}}`;
}).join("\n");

const CSS = `
.lost-table{width:min(100%,300px);height:auto;overflow:visible}
.lt-ring{fill:none;stroke:var(--line);stroke-width:2.5;stroke-dasharray:3 8;stroke-linecap:round}
.lt-arc{fill:none;stroke:var(--accent);stroke-width:5;stroke-linecap:round;stroke-dasharray:100 100;stroke-dashoffset:${(100 - (100 * (SEATS - 1)) / SEATS).toFixed(2)}}
.lt-seat{transform-box:fill-box;transform-origin:center}
.lt-halo{fill:var(--surface);stroke:var(--line);stroke-width:2.5}
.lt-empty{fill:var(--surface);stroke:var(--accent);stroke-width:2.5;stroke-dasharray:5 5}
.lt-q{fill:var(--accent);font:800 30px/1 var(--display,system-ui);text-anchor:middle;dominant-baseline:central;transform-box:fill-box;transform-origin:50% 60%}
.lt-wave{fill:none;stroke:var(--accent);stroke-width:2;opacity:0;transform-box:fill-box;transform-origin:center}
.lt-code{fill:var(--ink);font:800 58px/1 var(--display,system-ui);text-anchor:middle;dominant-baseline:central;letter-spacing:-.02em}
.lt-sub{fill:var(--ink-3);font:600 13px/1 var(--body,system-ui);text-anchor:middle;letter-spacing:.14em}
@media (prefers-reduced-motion:no-preference){
  .lt-arc{animation:lt-arc ${ROUND}s cubic-bezier(.45,0,.55,1) infinite}
  ${Array.from({ length: SEATS - 1 }, (_, i) => `.lt-s${i}{animation:lt-seat-${i} ${ROUND}s ease-out infinite}.lt-s${i} .lt-halo{animation:lt-halo-${i} ${ROUND}s ease-out infinite}`).join("")}
  .lt-q{animation:lt-q ${ROUND}s ease-in-out infinite}
  .lt-wave{animation:lt-wave ${ROUND}s ease-out infinite}
  .lt-code{animation:lt-code ${ROUND}s ease-in-out infinite}
}
@keyframes lt-arc{0%,${pct(reach(0))}{stroke-dashoffset:100;opacity:1}${pct(reach(SEATS - 1))}{stroke-dashoffset:${(100 - (100 * (SEATS - 1)) / SEATS).toFixed(2)};opacity:1}88%{stroke-dashoffset:${(100 - (100 * (SEATS - 1)) / SEATS).toFixed(2)};opacity:1}96%{opacity:0}100%{stroke-dashoffset:100;opacity:0}}
${seatKeyframes}
@keyframes lt-q{0%,${pct(reach(SEATS - 1))}{transform:rotate(0)}${pct(reach(SEATS - 1) + 0.03)}{transform:rotate(-14deg)}${pct(reach(SEATS - 1) + 0.06)}{transform:rotate(11deg)}${pct(reach(SEATS - 1) + 0.09)}{transform:rotate(-6deg)}${pct(reach(SEATS - 1) + 0.12)},100%{transform:rotate(0)}}
@keyframes lt-wave{0%,${pct(reach(SEATS - 1))}{opacity:0;transform:scale(1)}${pct(reach(SEATS - 1) + 0.01)}{opacity:.7;transform:scale(1)}${pct(reach(SEATS - 1) + 0.14)}{opacity:0;transform:scale(1.9)}100%{opacity:0}}
@keyframes lt-code{0%,${pct(reach(SEATS - 1))}{transform:none}${pct(reach(SEATS - 1) + 0.04)}{transform:translateY(-3px)}${pct(reach(SEATS - 1) + 0.1)},100%{transform:none}}
`;

export function LostTable({ code = "404", label }: { code?: string; label?: string }) {
  const faces = roundTableFaces();
  const empty = at(SEATS - 1);
  return (
    <svg className="lost-table" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
      <style>{CSS}</style>
      <circle className="lt-ring" cx="160" cy="160" r={R} />
      <circle className="lt-arc" cx="160" cy="160" r={R} pathLength="100" transform="rotate(-90 160 160)" />
      {faces.slice(0, SEATS - 1).map((f, i) => {
        const p = at(i);
        return (
          <g key={f.name} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
            <g className={`lt-seat lt-s${i}`}>
              <circle className="lt-halo" r="25" />
              <image href={f.src} x="-23" y="-23" width="46" height="46" />
            </g>
          </g>
        );
      })}
      {/* The seat left empty: the page that is not at the table */}
      <g transform={`translate(${empty.x.toFixed(1)} ${empty.y.toFixed(1)})`}>
        <circle className="lt-wave" r="25" />
        <circle className="lt-empty" r="25" />
        <text className="lt-q" x="0" y="1">
          ?
        </text>
      </g>
      <text className="lt-code" x="160" y={label ? 150 : 160}>
        {code}
      </text>
      {label && (
        <text className="lt-sub" x="160" y="192">
          {label}
        </text>
      )}
    </svg>
  );
}
