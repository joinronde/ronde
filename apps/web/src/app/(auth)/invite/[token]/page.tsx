import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AcceptInvitation } from "@/components/workspace/accept-invitation";
import { currentUser } from "@/lib/server/authz";
import { invitationState } from "@/lib/server/workspaces";

export const dynamic = "force-dynamic";

/** The tab says which invitation this is: the workspace to join, or why the link does not work */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await invitationState(token, await currentUser());
  const t = await getTranslations("invite");
  const title =
    state.status === "invalid"
      ? t("invalidTitle")
      : state.status === "expired"
        ? t("expiredTitle")
        : state.status === "member"
          ? t("memberTitle")
          : t("title", { workspace: state.workspace });
  return { title: `${title} · Ronde` };
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await currentUser();
  const state = await invitationState(token, user);
  const t = await getTranslations("invite");
  const tw = await getTranslations("workspace");
  const here = `/invite/${token}`;
  // A link that no longer opens a seat names the workspace and who invited only to the account it was sent to
  const named = (s: { email: string }) => !!user && user.email.toLowerCase() === s.email;

  if (state.status === "accepted") {
    const into = `/w/${state.slug}`;
    return (
      <div className="auth-body">
        <h1>{t("acceptedTitle")}</h1>
        <p>{named(state) ? t("accepted", { workspace: state.workspace }) : t("acceptedAnonymous")}</p>
        {user ? (
          // Signed in with an account that is not in the workspace: the one that accepted it is another
          <AcceptInvitation token={token} label={t("switchAccount")} switchAccount next={named(state) ? into : "/"} />
        ) : (
          <Link href="/sign-in" className="btn primary big">
            {t("goSignIn")}
          </Link>
        )}
      </div>
    );
  }
  if (state.status === "invalid" || state.status === "expired") {
    return (
      <div className="auth-body">
        <h1>{state.status === "invalid" ? t("invalidTitle") : t("expiredTitle")}</h1>
        <p>
          {state.status === "invalid"
            ? t("invalid")
            : state.inviter && named(state)
              ? t("expiredFrom", { workspace: state.workspace, inviter: state.inviter })
              : t("expired", { workspace: state.workspace })}
        </p>
        {/* Somewhere to go from here: one's own workspaces, or signing in */}
        <Link href={user ? "/" : "/sign-in"} className="link">
          {user ? t("openWorkspaces") : t("goSignIn")}
        </Link>
      </div>
    );
  }
  if (state.status === "member") {
    return (
      <div className="auth-body">
        <h1>{t("memberTitle")}</h1>
        <p>{t("member", { workspace: state.workspace })}</p>
        {state.forOther && (
          <p className="form-alert info">{t.rich("memberOther", { email: state.forOther, strong: (c) => <strong>{c}</strong> })}</p>
        )}
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
