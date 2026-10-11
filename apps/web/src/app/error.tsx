"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

/** A page failed to render: say so plainly and offer to try again, never a blank screen */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("states");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="state-page" role="alert">
      <h1>{t("errorTitle")}</h1>
      <p className="muted">{t("errorBody")}</p>
      {error.digest && <p className="hint">{t("errorRef", { ref: error.digest })}</p>}
      <div className="controls" style={{ justifyContent: "center" }}>
        <button type="button" className="btn primary" onClick={reset}>
          {t("retry")}
        </button>
        <Link href="/" className="btn">
          {t("home")}
        </Link>
      </div>
    </main>
  );
}
