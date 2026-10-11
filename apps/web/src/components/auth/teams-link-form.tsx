"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { linkTeamsAction } from "@/app/w/[ws]/actions";
import { Select } from "@/components/select";
import { TeamsMark } from "@/components/workspace/teams-settings";
import { Field, FormAlert } from "./fields";

/** The team to link (null: the link expired or was changed), and the workspaces the person may link it to */
export function TeamsLinkForm({
  token,
  team,
  choices,
}: {
  token: string;
  team: { name: string; channel: string } | null;
  choices: { slug: string; name: string; linked: string | null }[];
}) {
  const t = useTranslations("teams.link");
  const router = useRouter();
  const [slug, setSlug] = useState(choices[0]?.slug ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = choices.find((c) => c.slug === slug);
  const head = (
    <header className="auth-title">
      <span className="teams-link-mark" aria-hidden="true">
        <TeamsMark />
      </span>
      <h1>{t("title")}</h1>
    </header>
  );
  if (!team)
    return (
      <div className="auth-body">
        {head}
        <FormAlert>{t("expired")}</FormAlert>
      </div>
    );
  return (
    <div className="auth-body">
      {head}
      <p className="muted">{t("intro", { team: team.name })}</p>
      {team.channel && <p className="hint">{t("channel", { channel: team.channel })}</p>}
      <FormAlert>{error}</FormAlert>
      {choices.length ? (
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const res = await linkTeamsAction(slug, token);
            if (!res.ok) {
              setBusy(false);
              return setError(res.error);
            }
            router.replace(`/w/${slug}/settings?teams=linked#teams`);
          }}
        >
          <Field
            label={t("workspace")}
            hint={picked?.linked && picked.linked !== team.name ? t("replaces", { team: picked.linked }) : undefined}
          >
            {(p) => (
              <Select {...p} value={slug} onChange={(e) => setSlug(e.target.value)}>
                {choices.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <button type="submit" className="btn primary big" disabled={busy || !slug} aria-busy={busy}>
            {t("submit")}
          </button>
        </form>
      ) : (
        <p className="note-box">{t("none")}</p>
      )}
    </div>
  );
}
