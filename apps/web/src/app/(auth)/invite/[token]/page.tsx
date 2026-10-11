import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AcceptInvitation } from "@/components/workspace/accept-invitation";
import { currentUser } from "@/lib/server/authz";
import { invitationState } from "@/lib/server/workspaces";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ronde" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await currentUser();
  const state = await invitationState(token, user);
  const t = await getTranslations("invite");
  const tw = await getTranslations("workspace");
  const here = `/invite/${token}`;

  if (state.status === "invalid" || state.status === "expired") {
    return (
      <div className="auth-body">
        <h1>{state.status === "invalid" ? t("invalidTitle") : t("expiredTitle")}</h1>
        <p>{state.status === "invalid" ? t("invalid") : t("expired", { workspace: state.workspace })}</p>
        <Link href="/" className="link">
          Ronde
        </Link>
      </div>
    );
  }
  if (state.status === "member") {
    return (
      <div className="auth-body">
        <h1>{t("memberTitle")}</h1>
        <p>{t("member", { workspace: state.workspace })}</p>
        <Link href={`/w/${state.slug}`} className="btn primary big">
          {t("open", { workspace: state.workspace })}
        </Link>
      </div>
    );
  }
  const sameEmail = user && user.email.toLowerCase() === state.email;
  return (
    <div className="auth-body">
      <h1>{t("title", { workspace: state.workspace })}</h1>
      <p>{t("intro", { inviter: state.inviter || "Ronde", workspace: state.workspace })}</p>
      <p className="hint">{t("role", { role: tw(`roles.${state.role}`) })}</p>
      {!user && (
        <div className="stack">
          <Link href={`/sign-up?next=${encodeURIComponent(here)}&email=${encodeURIComponent(state.email)}`} className="btn primary big">
            {t("signUp")}
          </Link>
          <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className="btn big">
            {t("signIn")}
          </Link>
        </div>
      )}
      {user && sameEmail && (
        <>
          <p className="hint">{t.rich("signedInAs", { email: user.email, strong: (c) => <strong>{c}</strong> })}</p>
          <AcceptInvitation token={token} label={t("accept", { workspace: state.workspace })} />
        </>
      )}
      {user && !sameEmail && (
        <>
          <p className="form-alert info">{t.rich("otherEmail", { email: state.email, strong: (c) => <strong>{c}</strong> })}</p>
          <AcceptInvitation token={token} label={t("switchAccount")} switchAccount next={here} />
        </>
      )}
    </div>
  );
}
