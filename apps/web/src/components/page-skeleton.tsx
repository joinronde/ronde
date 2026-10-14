import { getTranslations } from "next-intl/server";
import { SKELETON_KINDS, type SkeletonKind } from "@/lib/shared/skeleton";

// Shown while a page loads: the shape of that page (its rows, its cards, its table...) so that what arrives takes the
// place the eye already found, and the word for screen readers

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Bars of text of varied lengths, so that rows do not look like a barcode */
const WIDTHS = [72, 54, 86, 63, 78, 48, 69, 58];

function Rows({ n, avatar }: { n: number; avatar?: boolean }) {
  return (
    <div className="sk-rows">
      {range(n).map((i) => (
        <div key={i} className="sk-row">
          {avatar && <div className="sk sk-dot" />}
          <div className="sk-stack">
            <div className="sk sk-text" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
            <div className="sk sk-text sm" style={{ width: `${WIDTHS[(i + 3) % WIDTHS.length]! / 2}%` }} />
          </div>
          <div className="sk sk-chip" />
        </div>
      ))}
    </div>
  );
}

function Cards({ n, tall }: { n: number; tall?: boolean }) {
  return (
    <div className="sk-grid">
      {range(n).map((i) => (
        <div key={i} className={`sk-card${tall ? " tall" : ""}`}>
          <div className="sk-row">
            <div className="sk sk-dot" />
            <div className="sk sk-text" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
          </div>
          <div className="sk sk-text sm" />
          <div className="sk sk-text sm" style={{ width: "62%" }} />
        </div>
      ))}
    </div>
  );
}

function Table({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="sk-table" style={{ "--cols": cols } as React.CSSProperties}>
      <div className="sk-tr head">
        {range(cols).map((c) => (
          <div key={c} className="sk sk-text sm" style={{ width: c ? "50%" : "30%" }} />
        ))}
      </div>
      {range(rows).map((r) => (
        <div key={r} className="sk-tr">
          {range(cols).map((c) => (
            <div key={c} className="sk sk-text" style={{ width: `${WIDTHS[(r + c) % WIDTHS.length]}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Body({ kind }: { kind: SkeletonKind }) {
  switch (kind) {
    case "list":
      return (
        <>
          <div className="sk sk-bar" />
          <Rows n={7} />
        </>
      );
    case "people":
      return (
        <>
          <div className="sk sk-bar" />
          <Rows n={8} avatar />
        </>
      );
    case "cards":
      return (
        <>
          <div className="sk sk-bar" />
          <Cards n={6} />
        </>
      );
    case "table":
      return (
        <>
          <div className="sk sk-bar" />
          <Table rows={8} cols={5} />
        </>
      );
    case "dashboard":
      return (
        <>
          <div className="sk sk-hero" />
          <div className="sk-cols">
            <Rows n={4} />
            <Cards n={2} />
          </div>
        </>
      );
    case "form":
      return (
        <div className="sk-form">
          {range(3).map((i) => (
            <div key={i} className="sk-card">
              <div className="sk sk-text" style={{ width: "34%" }} />
              <div className="sk sk-text sm" style={{ width: "70%" }} />
              <div className="sk sk-field" />
              <div className="sk sk-field" />
            </div>
          ))}
        </div>
      );
    case "detail":
      return (
        <>
          <div className="sk-row sk-head">
            <div className="sk sk-avatar" />
            <div className="sk-stack">
              <div className="sk sk-text" style={{ width: "40%" }} />
              <div className="sk sk-text sm" style={{ width: "26%" }} />
            </div>
          </div>
          <div className="sk-cols">
            <Rows n={5} />
            <Cards n={2} />
          </div>
        </>
      );
    case "calendar":
      return (
        <>
          <div className="sk sk-bar" />
          <div className="sk-month">
            {range(35).map((i) => (
              <div key={i} className="sk-day">
                <div className="sk sk-text sm" style={{ width: "24%" }} />
                {i % 3 === 1 && <div className="sk sk-text" />}
              </div>
            ))}
          </div>
        </>
      );
    case "stats":
      return (
        <>
          <div className="sk-kpis">
            {range(4).map((i) => (
              <div key={i} className="sk sk-kpi" />
            ))}
          </div>
          <div className="sk-cols">
            <div className="sk sk-chart" />
            <div className="sk sk-chart" />
          </div>
        </>
      );
    case "control":
      return (
        <div className="sk-cols wide">
          <div className="sk-stack">
            <div className="sk sk-deck" />
            <Rows n={5} avatar />
          </div>
          <div className="sk-card tall">
            <div className="sk sk-bar" />
            <Rows n={4} />
          </div>
        </div>
      );
    case "doc":
      return (
        <div className="sk-doc">
          <div className="sk-stack">
            {range(6).map((i) => (
              <div key={i} className="sk sk-text sm" style={{ width: `${WIDTHS[i]}%` }} />
            ))}
          </div>
          <div className="sk-stack">
            <div className="sk sk-text" style={{ width: "30%" }} />
            <Cards n={4} tall />
          </div>
        </div>
      );
  }
}

/** The page's title, its subtitle, then its body in the shape of the page loaded */
export async function PageSkeleton({ kind = "cards" }: { kind?: SkeletonKind }) {
  const t = await getTranslations("states");
  return (
    <div className={`page skeleton sk-${SKELETON_KINDS.includes(kind) ? kind : "cards"}`} aria-busy="true">
      <p className="sr-only" role="status">
        {t("loading")}
      </p>
      <div className="sk-titles">
        <div className="sk sk-title" />
        <div className="sk sk-line" />
      </div>
      <Body kind={kind} />
    </div>
  );
}
