"use client";

import type { WorkspaceRole } from "@ronde/core/permissions";
import { slugify } from "@ronde/core/slug";
import { type Locale, localeNames } from "@ronde/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createWorkspaceAction, joinInvitationAction, suggestSlugAction } from "@/app/onboarding/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { track } from "@/lib/shared/track";
import { browserTimeZone, LocaleSelect, TimeZoneSelect } from "./inputs";

interface PendingInvitation {
  id: string;
  role: WorkspaceRole;
  workspace: { name: string; slug: string };
}

export function Onboarding({
  firstName,
  invitations,
  workspaces,
  plan = null,
  template = null,
}: {
  firstName: string;
  invitations: PendingInvitation[];
  workspaces: { slug: string; name: string }[];
  /** Chosen on the site (cloud): the new workspace goes on to pay for it */
  plan?: "team" | null;
  /** A built-in template picked on the site: the first meeting starts from it */
  template?: string | null;
}) {
  const t = useTranslations("onboarding");
  const tw = useTranslations("workspace");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [lang, setLang] = useState<string>(locale);
  const [timezone, setTimezone] = useState("UTC");
  // Only the name is asked: the address follows it, the language and time zone are this browser's, and all three
  // are one click away (and in the settings later)
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const suggestion = useRef(0);
  const newMeeting = (ws: string) => `/w/${ws}/meetings/new?template=${encodeURIComponent(`builtin:${template}`)}`;

  useEffect(() => setTimezone(browserTimeZone()), []);

  // Address follows the name until it is edited by hand; the server proposes a free one
  useEffect(() => {
    if (slugEdited || !name.trim()) return;
    setSlug(slugify(name));
    const id = ++suggestion.current;
    const timer = setTimeout(async () => {
      const res = await suggestSlugAction(name);
      if (res.ok && id === suggestion.current) setSlug(res.data);
    }, 300);
    return () => clearTimeout(timer);
  }, [name, slugEdited]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("create");
    setError(null);
    const res = await createWorkspaceAction({ name, slug, locale: lang, timezone });
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      setMore(true);
      return;
    }
    track("workspace_created");
    router.push(plan ? `/w/${res.data.slug}/settings/billing` : template ? newMeeting(res.data.slug) : `/w/${res.data.slug}`);
  };

  const join = async (id: string) => {
    setBusy(id);
    setError(null);
    const res = await joinInvitationAction(id);
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    track("invite_accepted");
    router.push(`/w/${res.data.slug}`);
  };

  return (
    <div className="auth-body wide">
      <h1>{t("welcome", { name: firstName })}</h1>
      <FormAlert>{error}</FormAlert>
      {invitations.length > 0 && (
        <section className="stack" aria-labelledby="invitations-title">
          <h2 id="invitations-title">{t("invitationsTitle")}</h2>
          <ul className="choice-list">
            {invitations.map((inv) => (
              <li key={inv.id}>
                <span>
                  <strong>{inv.workspace.name}</strong>
                  <span className="hint"> · {tw(`roles.${inv.role}`)}</span>
                </span>
                <button type="button" className="btn primary" disabled={!!busy} aria-busy={busy === inv.id} onClick={() => join(inv.id)}>
                  {t("join")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {workspaces.length > 0 && (
        <section className="stack" aria-labelledby="workspaces-title">
          <h2 id="workspaces-title">{t("yourWorkspaces")}</h2>
          <ul className="choice-list">
            {workspaces.map((w) => (
              <li key={w.slug}>
                <strong>{w.name}</strong>
                <Link className="btn" href={template ? newMeeting(w.slug) : `/w/${w.slug}`}>
                  {t("open")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="stack" aria-labelledby="create-title">
        <h2 id="create-title">{invitations.length || workspaces.length ? t("createOwn") : t("title")}</h2>
        <p className="muted">{t("intro")}</p>
        <form className="auth-form" onSubmit={create}>
          <Field label={t("name")}>
            {(p) => (
              <input
                {...p}
                type="text"
                required
                maxLength={80}
                placeholder={t("namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus={!invitations.length}
              />
            )}
          </Field>
          {more ? (
            <>
              <Field label={t("slug")} hint={t("slugHint")}>
                {(p) => (
                  <span className="prefixed">
                    <span aria-hidden="true">/w/</span>
                    <input
                      {...p}
                      type="text"
                      required
                      maxLength={40}
                      pattern="[a-z0-9](?:[a-z0-9\-]{0,38}[a-z0-9])?"
                      value={slug}
                      onChange={(e) => {
                        setSlugEdited(true);
                        setSlug(e.target.value.toLowerCase());
                      }}
                    />
                  </span>
                )}
              </Field>
              <div className="grid2 stack-sm">
                <Field label={t("language")}>{(p) => <LocaleSelect {...p} value={lang} onChange={setLang} />}</Field>
                <Field label={t("timezone")}>{(p) => <TimeZoneSelect {...p} value={timezone} onChange={setTimezone} />}</Field>
              </div>
            </>
          ) : (
            <p className="hint onboard-defaults">
              {t("defaults", {
                address: `/w/${slug || slugify(name) || "…"}`,
                language: localeNames[lang as Locale] ?? lang,
                timezone: timezone.replaceAll("_", " "),
              })}{" "}
              <button type="button" className="link-btn" onClick={() => setMore(true)}>
                {t("change")}
              </button>
            </p>
          )}
          <button type="submit" className="btn primary big" disabled={!!busy} aria-busy={busy === "create"}>
            {t("create")}
          </button>
        </form>
      </section>
    </div>
  );
}
