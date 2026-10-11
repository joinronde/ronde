"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FeedbackDialog, type FeedbackTo, feedbackSetting } from "@/components/feedback";
import { BASE_PATH } from "@/lib/shared/base-path";

/** A page failed to render: say so plainly and offer to try again, never a blank screen */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("states");
  const [feedback, setFeedback] = useState<FeedbackTo | null>(null);
  const [report, setReport] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  useEffect(() => {
    console.error(error);
    setFeedback(feedbackSetting());
    // The workspace of the page, so the message says where it happened
    setWorkspace(/^\/w\/([^/]+)/.exec(location.pathname.slice(BASE_PATH.length))?.[1] ?? null);
  }, [error]);
  return (
    <>
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
        {/* Telling what happened helps fix it: the reference of the error goes with the message */}
        {feedback && (
          <button type="button" className="link-btn" onClick={() => setReport(true)}>
            {t("report")}
          </button>
        )}
      </main>
      {report && feedback && (
        <FeedbackDialog to={feedback} kind="bug" errorRef={error.digest} workspace={workspace} onClose={() => setReport(false)} />
      )}
    </>
  );
}
