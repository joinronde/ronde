import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SignInForm } from "@/components/auth/sign-in-form";
import { signInProviders, signupOpen } from "@/lib/server/auth";
import { currentUser } from "@/lib/server/authz";
import { companyLdapAvailable, companySsoAvailable } from "@/lib/server/identity";
import { canSendEmail } from "@/lib/server/mailer";
import { safeNext } from "@/lib/shared/safe-next";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: `${t("signIn")} · Ronde` };
}

// Better Auth sends back an error code in the URL when a link or a provider fails
const URL_ERRORS: Record<string, "linkExpired" | "signupNotAllowed" | "accountDisabled" | "generic"> = {
  INVALID_TOKEN: "linkExpired",
  EXPIRED_TOKEN: "linkExpired",
  TOKEN_EXPIRED: "linkExpired",
  SIGNUP_NOT_ALLOWED: "signupNotAllowed",
  signup_disabled: "signupNotAllowed",
  ACCOUNT_DISABLED: "accountDisabled",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (await currentUser()) redirect(safeNext(next));
  return (
    <SignInForm
      providers={signInProviders()}
      next={next}
      initialError={error ? (URL_ERRORS[error] ?? "generic") : null}
      mailConfigured={canSendEmail()}
      signupOpen={await signupOpen()}
      companySso={await companySsoAvailable()}
      companyLdap={await companyLdapAvailable()}
    />
  );
}
