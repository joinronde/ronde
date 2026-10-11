import { getTranslations } from "next-intl/server";
import { ScreenView } from "@/components/screen";

export async function generateMetadata() {
  const t = await getTranslations("pages");
  return { title: t("title", { page: t("screen") }) };
}

export default function Page() {
  return <ScreenView />;
}
