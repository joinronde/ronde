import { getTranslations } from "next-intl/server";

// A guest link expired, revoked or mistyped: what happened and what to do. Its guest has no account, so no
// sign-in page and no home to go back to
export default async function GuestLinkGone() {
  const t = await getTranslations("states");
  return (
    <main id="main" className="state-page">
      <h1>{t("guestLinkGoneTitle")}</h1>
      <p className="muted">{t("guestLinkGone")}</p>
    </main>
  );
}
