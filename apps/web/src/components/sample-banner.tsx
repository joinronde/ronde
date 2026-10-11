"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteSampleAction } from "@/app/w/[ws]/actions";
import { withBasePath } from "@/lib/shared/base-path";
import { track } from "@/lib/shared/track";
import { useRonde } from "./ronde-provider";
import { useConfirm } from "./workspace/confirm";

/** On every page of the sample meeting: what it is, and the way to delete it for good */
export function SampleBanner() {
  const t = useTranslations("sample");
  const { s, toast } = useRonde();
  const [dialog, ask] = useConfirm();
  const [busy, setBusy] = useState(false);
  if (!s.context.sample) return null;
  const canDelete = s.viewer.isHost || s.viewer.isAdmin;
  const remove = async () => {
    if (!(await ask({ message: t("deleteConfirm"), confirmLabel: t("delete"), danger: true }))) return;
    setBusy(true);
    const res = await deleteSampleAction(s.context.workspace.slug, s.context.meetingId);
    if (!res.ok) {
      setBusy(false);
      toast(res.error);
      return;
    }
    track("sample_deleted");
    // A full load: the meeting's live connection and the sidebar start over without it
    window.location.assign(withBasePath(`/w/${s.context.workspace.slug}`));
  };
  return (
    <div className="sample-banner" role="note">
      <span className="sample-chip">{t("badge")}</span>
      <span className="grow">{t("banner")}</span>
      {canDelete && (
        <button type="button" className="btn sm danger" onClick={remove} disabled={busy} aria-busy={busy}>
          {t("delete")}
        </button>
      )}
      {dialog}
    </div>
  );
}
