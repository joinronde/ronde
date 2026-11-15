import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { signInProviders, signupOpen } from "@/lib/server/auth";
import { currentUser } from "@/lib/server/authz";
import { env } from "@/lib/server/env";
import { isCloud } from "@/lib/server/license";
import { canSendEmail } from "@/lib/server/mailer";
import { invitationState } from "@/lib/server/workspaces";
import { safeNext } from "@/lib/shared/safe-next";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: `${t("signUp")} · Ronde` };
}

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  if (await currentUser()) redirect(safeNext(next));
  // Invite-only instance: the form stays reachable from a valid invitation link (it carries the next path);
  // a link that no longer works shows why on its own page, before anything is typed for nothing
  const token = next?.startsWith("/invite/") ? next.slice("/invite/".length) : null;
  const state = token ? await invitationState(token, null) : null;
  const invited = state?.status === "pending" ? state : null;
  if (token && !invited && !(await signupOpen())) redirect(safeNext(next));
  if (!invited && !(await signupOpen())) {
    const t = await getTranslations("auth");
    return (
      <div className="auth-body">
        <h1>{t("signUpTitle")}</h1>
        <p>{t("inviteOnly")}</p>
        <Link href="/sign-in" className="link">
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }
  // In the cloud, an account accepts the terms and the privacy policy of the site
  const site = `${env.siteUrl()}/${await getLocale()}`;
  return (
    <SignUpForm
      providers={signInProviders()}
      next={next}
      email={email}
      invitation={invited && token ? { token, workspace: invited.workspace, inviter: invited.inviter, email: invited.email } : null}
      mailConfigured={canSendEmail()}
      legal={isCloud() ? { terms: `${site}/terms`, privacy: `${site}/privacy` } : null}
    />
  );
}
