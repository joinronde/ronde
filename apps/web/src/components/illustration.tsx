// Drawings for empty pages: one family (a soft disc, sheets of paper, a touch of accent), drawn with the theme's
// colours so they follow light and dark. Decorative: hidden from screen readers, the text beside them says it all

import type { ReactNode } from "react";

export const ILLUSTRATIONS = [
  "actions",
  "decisions",
  "people",
  "meetings",
  "kudos",
  "projects",
  "history",
  "stats",
  "search",
  "error",
] as const;
export type IllustrationName = (typeof ILLUSTRATIONS)[number];

/** A sheet of paper: the drawings' common ground */
const Sheet = ({ x, y, w, h, r = 8 }: { x: number; y: number; w: number; h: number; r?: number }) => (
  <rect className="ill-paper" x={x} y={y} width={w} height={h} rx={r} />
);
/** A line of text on a sheet */
const Line = ({ x, y, w, soft }: { x: number; y: number; w: number; soft?: boolean }) => (
  <rect className={soft ? "ill-line soft" : "ill-line"} x={x} y={y} width={w} height={5} rx={2.5} />
);
const Check = ({ cx, cy, r = 9 }: { cx: number; cy: number; r?: number }) => (
  <g>
    <circle className="ill-acc" cx={cx} cy={cy} r={r} />
    <path className="ill-on-acc" d={`M${cx - r * 0.42} ${cy}l${r * 0.3} ${r * 0.32} ${r * 0.55}-${r * 0.62}`} />
  </g>
);
const Spark = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <path className="ill-spark" transform={`translate(${x} ${y}) scale(${s})`} d="M0-7C1-2 2-1 7 0 2 1 1 2 0 7-1 2-2 1-7 0-2-1-1-2 0-7Z" />
);

const SCENES: Record<IllustrationName, ReactNode> = {
  actions: (
    <>
      <Sheet x={46} y={22} w={68} h={82} />
      <rect className="ill-acc soft" x={66} y={16} width={28} height={12} rx={6} />
      {[42, 62, 82].map((y, i) => (
        <g key={y}>
          <rect className={i === 0 ? "ill-acc" : "ill-box"} x={56} y={y - 5} width={10} height={10} rx={3} />
          {i === 0 && <path className="ill-on-acc" d={`M58.5 ${y}l2 2 3.5-4`} />}
          <Line x={72} y={y - 2.5} w={i === 1 ? 30 : 34} soft={i === 0} />
        </g>
      ))}
      <Spark x={124} y={34} />
    </>
  ),
  decisions: (
    <>
      <Sheet x={34} y={30} w={64} h={74} />
      <Sheet x={56} y={18} w={70} h={80} />
      <Line x={68} y={34} w={40} />
      <Line x={68} y={46} w={46} soft />
      <Line x={68} y={56} w={34} soft />
      <Check cx={110} cy={82} r={13} />
    </>
  ),
  people: (
    <>
      <circle className="ill-paper" cx={58} cy={70} r={20} />
      <circle className="ill-paper" cx={102} cy={70} r={20} />
      <circle className="ill-acc" cx={80} cy={50} r={22} />
      <circle className="ill-on-acc-fill" cx={80} cy={45} r={7} />
      <path className="ill-on-acc-fill" d="M67 63c3-7 23-7 26 0v2H67z" />
      {/* The two others: a head and shoulders, in the lines' ink */}
      {[58, 102].map((x) => (
        <g key={x} className="ill-line">
          <circle cx={x} cy={66} r={5.5} />
          <path d={`M${x - 10} 82c2-6 18-6 20 0z`} />
        </g>
      ))}
      <Spark x={126} y={36} s={0.8} />
    </>
  ),
  meetings: (
    <>
      <Sheet x={38} y={26} w={76} h={74} />
      <rect className="ill-acc" x={38} y={26} width={76} height={16} rx={8} />
      <rect className="ill-acc" x={38} y={34} width={76} height={8} />
      {[0, 1, 2, 3].map((c) =>
        [0, 1, 2].map((r) => (
          <rect
            key={`${c}-${r}`}
            className={c === 2 && r === 1 ? "ill-acc soft" : "ill-box"}
            x={48 + c * 15}
            y={50 + r * 15}
            width={10}
            height={9}
            rx={2.5}
          />
        )),
      )}
      <circle className="ill-paper" cx={116} cy={88} r={15} />
      <path className="ill-hand" d="M116 80v8l5 4" />
    </>
  ),
  kudos: (
    <>
      <Sheet x={40} y={30} w={80} h={66} r={12} />
      <path className="ill-acc" d="M80 82c-12-8-20-15-20-24a10 10 0 0 1 20-4 10 10 0 0 1 20 4c0 9-8 16-20 24z" />
      <Spark x={44} y={28} />
      <Spark x={122} y={46} s={0.8} />
      <Spark x={112} y={98} s={0.6} />
    </>
  ),
  projects: (
    <>
      {[34, 70, 106].map((x, i) => (
        <g key={x}>
          <rect className="ill-box" x={x} y={26} width={30} height={78} rx={8} />
          <rect className={i === 1 ? "ill-acc" : "ill-paper"} x={x + 4} y={32 + i * 6} width={22} height={18} rx={5} />
          {i !== 2 && <rect className="ill-paper" x={x + 4} y={56 + i * 6} width={22} height={14} rx={5} />}
        </g>
      ))}
    </>
  ),
  history: (
    <>
      <Sheet x={44} y={34} w={62} h={70} />
      <Sheet x={50} y={26} w={62} h={70} />
      <Sheet x={56} y={18} w={62} h={70} />
      <Line x={66} y={32} w={36} />
      <Line x={66} y={44} w={42} soft />
      <Line x={66} y={54} w={30} soft />
      <circle className="ill-acc" cx={112} cy={86} r={15} />
      <path className="ill-on-acc" d="M112 78v8l5 4" />
    </>
  ),
  stats: (
    <>
      <Sheet x={30} y={22} w={100} h={80} />
      {[24, 38, 30, 52].map((h, i) => (
        <rect key={h} className={i === 3 ? "ill-acc" : "ill-box"} x={44 + i * 20} y={90 - h} width={12} height={h} rx={3} />
      ))}
      <path className="ill-trend" d="M44 62l20-10 20 6 22-24" />
      <circle className="ill-acc" cx={106} cy={34} r={4} />
    </>
  ),
  search: (
    <>
      <Sheet x={36} y={28} w={70} h={72} />
      <Line x={48} y={42} w={40} />
      <Line x={48} y={54} w={46} soft />
      <Line x={48} y={66} w={30} soft />
      <circle className="ill-glass" cx={104} cy={76} r={16} />
      <path className="ill-handle" d="M116 88l12 12" />
    </>
  ),
  error: (
    <>
      <path className="ill-paper" d="M52 92a18 18 0 0 1 2-36 26 26 0 0 1 50-6 20 20 0 0 1 4 42z" />
      <path className="ill-hand" d="M80 56v16" />
      <circle className="ill-acc" cx={80} cy={81} r={3.2} />
    </>
  ),
};

/** One of the drawings, at the given width (its height follows) */
export function Illustration({ name, size = 160 }: { name: IllustrationName; size?: number }) {
  return (
    <svg className={`ill ill-${name}`} viewBox="0 0 160 120" width={size} height={(size * 3) / 4} aria-hidden="true" focusable="false">
      <ellipse className="ill-bg" cx={80} cy={64} rx={64} ry={50} />
      {SCENES[name]}
    </svg>
  );
}

/** A page with nothing yet: the drawing, what is missing, what to do, and the way to do it */
export function EmptyHero({
  art,
  title,
  hint,
  children,
  compact,
  alert,
}: {
  art: IllustrationName;
  title: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** Within a panel rather than a whole page */
  compact?: boolean;
  /** Something went wrong, said to screen readers as it shows */
  alert?: boolean;
}) {
  return (
    <div className={`empty-hero${compact ? " compact" : ""}`} role={alert ? "alert" : undefined}>
      <Illustration name={art} size={compact ? 120 : 168} />
      {compact ? <h3>{title}</h3> : <h2>{title}</h2>}
      {hint && <p className="hint">{hint}</p>}
      {children && <div className="empty-hero-actions">{children}</div>}
    </div>
  );
}
