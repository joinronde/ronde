import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "@/components/auth/password-reset";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: `${t("resetTitle")} · Ronde` };
}

// Reached from the reset email: Better Auth checks the token, then redirects here with ?token= (or ?error=)
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={error ? null : (token ?? null)} />;
}
