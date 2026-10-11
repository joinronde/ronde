import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "@/components/auth/password-reset";
import { canSendEmail } from "@/lib/server/mailer";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: `${t("forgotTitle")} · Ronde` };
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return <ForgotPasswordForm email={email} mailConfigured={canSendEmail()} />;
}
