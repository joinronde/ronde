import { getTranslations } from "next-intl/server";
import { TwoFactorForm } from "@/components/auth/two-factor-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: `${t("twoFactorTitle")} · Ronde` };
}

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <TwoFactorForm next={next} />;
}
