import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TwoFactorForm } from "@/components/auth/two-factor-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: `${t("twoFactorTitle")} · Ronde` };
}

/** The cookie Better Auth sets while a sign-in waits for its second factor (Secure-prefixed over HTTPS) */
const CHALLENGE = ["ronde.two_factor", "__Secure-ronde.two_factor"];

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // No sign-in waiting for a code (a bookmark, a tab left open, the challenge expired): a code could only be refused
  const jar = await cookies();
  if (!CHALLENGE.some((name) => jar.get(name))) redirect("/sign-in?error=TWO_FACTOR_EXPIRED");
  const t = await getTranslations("auth");
  return (
    <TwoFactorForm next={next}>
      <p className="hint">{t("twoFactorLost")}</p>
      <Link href="/sign-in" className="link">
        {t("twoFactorOtherAccount")}
      </Link>
    </TwoFactorForm>
  );
}
